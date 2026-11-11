import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAdmin } from "../admin-auth.js";
import { sendAlert } from "../alerts.js";
import { authenticate } from "../auth.js";
import { isCustomerMailConfigured, sendCustomerEmails } from "../customer-mail.js";
import { ApiError } from "../errors.js";
import { deskLink, siteUrl } from "../links.js";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_REPLY_HOURS,
  SUPPORT_STATUSES,
  SupportReply,
  SupportTicket,
  User,
  type ISupportTicket,
  type SupportCategory,
} from "../models.js";
import { NairaAccount, Position } from "../trading/models.js";

/**
 * The support desk. A signed-in customer opens a request (a category, a
 * subject, their message) from the site's Support page and follows the
 * thread there; the desk reads every request under Admin → Support,
 * replies — each reply is emailed to the customer as well — and closes it.
 * A customer writing again reopens a closed request.
 *
 * The desk is emailed (SUPPORT_EMAIL_TO, else the alert list) for every
 * new request, and when a customer writes again on one that had been
 * answered or closed — the request coming back to us — with a link that
 * opens it. More messages on a request that's already waiting don't
 * email again: the inbox shows it waiting.
 *
 * Run like a helpdesk:
 *  - every request waiting on us has a reply-by time (`dueAt`, from
 *    SUPPORT_REPLY_HOURS — money within the hour), and the waiting inbox
 *    is sorted by it, soonest first;
 *  - each request has an owner (`assignee`): taken with a click, or by
 *    whoever replies first, so two people never answer one customer;
 *  - the customer gets a "we've got it" email the moment they write,
 *    with their request number and when to expect an answer;
 *  - saved replies (SupportReply) answer the questions that keep coming.
 *
 * Text only, stored as written and rendered as text on both sides. A
 * customer may have a handful of requests waiting at once, so a stuck
 * button can't flood the inbox.
 */

const MAX_WAITING_PER_CUSTOMER = 5;
const MAX_MESSAGES = 200;
const PAGE = 50;

const ticketRef = z.string().regex(/^WS-[A-Z0-9]{6}$/, "Not a request number");
const messageText = z.string().trim().min(1, "Write a message").max(4000);

const createBody = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(3, "Add a short subject").max(120),
  message: z.string().trim().min(10, "Tell us a little more — at least 10 characters").max(4000),
});
const replyBody = z.object({ message: messageText });
const deskReplyBody = z.object({ message: messageText, close: z.boolean().default(false) });
const statusBody = z.object({ status: z.enum(["open", "closed"]) });
const deskListQuery = z.object({
  status: z.enum([...SUPPORT_STATUSES, "all"]).default("open"),
  /** Whose: everyone's, the asking admin's, or nobody's yet. */
  owner: z.enum(["anyone", "mine", "unassigned"]).default("anyone"),
  search: z.string().trim().max(120).optional(),
  offset: z.coerce.number().int().min(0).default(0),
});
const assignBody = z.object({ to: z.enum(["me", "nobody"]) });
const savedReplyBody = z.object({
  title: z.string().trim().min(2, "Give it a short name").max(80),
  body: z.string().trim().min(2, "Write the reply").max(4000),
});
const savedReplyId = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, "Not a saved reply") });
const MAX_SAVED_REPLIES = 100;

/** "WS-" and six characters nobody misreads (no 0/O, 1/I). */
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function newRef(): string {
  const bytes = randomBytes(6);
  let ref = "WS-";
  for (const b of bytes) ref += REF_ALPHABET[b % REF_ALPHABET.length];
  return ref;
}

type TicketDoc = Pick<
  ISupportTicket,
  "ref" | "authUserId" | "email" | "username" | "category" | "subject" | "status" | "messages" | "lastMessageAt"
> & { createdAt?: Date | null; assignee?: string | null; dueAt?: Date | null };

const HOUR_MS = 3_600_000;

/** When a request that starts waiting at `from` should be answered by. */
function dueFrom(category: SupportCategory, from: Date): Date {
  return new Date(from.getTime() + SUPPORT_REPLY_HOURS[category] * HOUR_MS);
}

/** "within an hour" / "within 4 hours" / "within a day" — the customer's promise. */
function replyWithin(category: SupportCategory): string {
  const h = SUPPORT_REPLY_HOURS[category];
  if (h === 1) return "within an hour";
  if (h === 24) return "within a day";
  return h < 24 ? `within ${h} hours` : `within ${Math.round(h / 24)} days`;
}

/**
 * The reply-by time while it waits on us, null otherwise. A request from
 * before reply-by times existed counts from its last message.
 */
function dueOf(t: TicketDoc): string | null {
  if (t.status !== "open") return null;
  return (t.dueAt ?? dueFrom(t.category, t.lastMessageAt)).toISOString();
}

/** The customer's view: who on the desk replied stays with the desk. */
function forCustomer(t: TicketDoc) {
  return {
    ref: t.ref,
    category: t.category,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt?.toISOString() ?? null,
    lastMessageAt: t.lastMessageAt.toISOString(),
    messages: t.messages.map((m) => ({ from: m.from, body: m.body, at: m.at.toISOString() })),
  };
}

function forDesk(t: TicketDoc) {
  return {
    ...forCustomer(t),
    authUserId: t.authUserId,
    email: t.email ?? "",
    username: t.username ?? "",
    assignee: t.assignee ?? "",
    dueAt: dueOf(t),
    messages: t.messages.map((m) => ({
      from: m.from,
      body: m.body,
      by: m.by ?? "",
      at: m.at.toISOString(),
    })),
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CATEGORY_LABEL: Record<(typeof SUPPORT_CATEGORIES)[number], string> = {
  money: "Deposits & withdrawals",
  bets: "A bet or market",
  account: "My account",
  other: "Something else",
};

/** Tell the desk a request needs them. Best-effort: a failed alert never fails the customer's send. */
function alertDesk(
  log: FastifyBaseLogger,
  subject: string,
  t: { ref: string; username: string; email: string; category: SupportCategory; assignee?: string | null | undefined },
  message: string,
): Promise<unknown> {
  return sendAlert(
    log,
    subject,
    {
      request: t.ref,
      from: `@${t.username}${t.email ? ` (${t.email})` : ""}`,
      about: CATEGORY_LABEL[t.category],
      replyBy: `${replyWithin(t.category)} of now`,
      ...(t.assignee ? { owner: t.assignee } : {}),
      message: message.length > 1500 ? `${message.slice(0, 1500)}…` : message,
    },
    { kind: "support", link: deskLink.supportRequest(t.ref), action: "Reply" },
  ).catch((err: unknown) => log.error({ err }, "support alert failed"));
}

/** The customer's Support page — linked from every email they get from the desk. */
function supportPageLine(ref: string): string {
  const url = siteUrl("/support");
  return url
    ? `To reply or follow request ${ref}: ${url}`
    : `To reply, open Support on WorldStreet Predict and find request ${ref}.`;
}

/** "We've got it": sent the moment a request is opened. Best-effort, like the desk's alert. */
async function acknowledge(
  log: FastifyBaseLogger,
  t: { ref: string; username: string; email: string; category: SupportCategory; subject: string },
): Promise<void> {
  if (!t.email) return;
  await sendCustomerEmails(log, [
    {
      to: t.email,
      subject: `We've got your request [${t.ref}]`,
      text: [
        `Hi ${t.username || "there"},`,
        "",
        `Thanks for getting in touch. We've got your request "${t.subject}" — its number is ${t.ref}.`,
        `We aim to reply ${replyWithin(t.category)}, by email and on the site.`,
        "",
        "— WorldStreet Support",
        "",
        supportPageLine(t.ref),
      ].join("\n"),
    },
  ]).catch((err: unknown) => log.error({ err }, "support acknowledgement failed"));
}

/*
 * The customer's side as plain functions — what the routes run after
 * sign-in, exported so the smoke tests can drive them without Clerk.
 * Given a logger, they also alert the desk.
 */

export async function listMyTickets(authUserId: string) {
  const tickets = await SupportTicket.find({ authUserId })
    .sort({ lastMessageAt: -1 })
    .limit(PAGE)
    .lean<TicketDoc[]>();
  return tickets.map(forCustomer);
}

export async function openTicket(
  customer: { authUserId: string; email: string; username: string },
  body: z.infer<typeof createBody>,
  log?: FastifyBaseLogger,
) {
  const waiting = await SupportTicket.countDocuments({
    authUserId: customer.authUserId,
    status: { $ne: "closed" },
  });
  if (waiting >= MAX_WAITING_PER_CUSTOMER) {
    throw new ApiError(
      409,
      `You already have ${waiting} requests open — add to one of those instead`,
      "TOO_MANY_OPEN",
    );
  }
  const at = new Date();
  const fields = {
    ...customer,
    category: body.category,
    subject: body.subject,
    status: "open" as const,
    messages: [{ from: "customer" as const, body: body.message, by: "", at }],
    lastMessageAt: at,
    dueAt: dueFrom(body.category, at),
  };
  // a clash on the six-character number is rare; try a fresh one
  for (let attempt = 0; ; attempt++) {
    try {
      const ticket = await SupportTicket.create({ ...fields, ref: newRef() });
      if (log) {
        const t = { ...customer, ref: ticket.ref, category: body.category, subject: body.subject };
        await Promise.all([
          alertDesk(log, `New support request ${ticket.ref}: ${body.subject}`, t, body.message),
          acknowledge(log, t),
        ]);
      }
      return forCustomer(ticket.toObject());
    } catch (err) {
      const dup = err && typeof err === "object" && "code" in err && err.code === 11000;
      if (!dup || attempt >= 4) throw err;
    }
  }
}

export async function writeAgain(authUserId: string, ref: string, message: string, log?: FastifyBaseLogger) {
  // whether it was already waiting on us decides if the desk hears about
  // it, and whether the reply-by clock starts again
  const before = await SupportTicket.findOne({ ref, authUserId }, { status: 1, category: 1 }).lean();
  const at = new Date();
  const comingBack = before !== null && before.status !== "open";
  const ticket = await SupportTicket.findOneAndUpdate(
    { ref, authUserId, [`messages.${MAX_MESSAGES - 1}`]: { $exists: false } },
    {
      $push: { messages: { from: "customer", body: message, by: "", at } },
      $set: {
        status: "open",
        lastMessageAt: at,
        ...(comingBack ? { dueAt: dueFrom(before.category, at) } : {}),
      },
    },
    { new: true },
  ).lean<TicketDoc>();
  if (!ticket) {
    if (!(await SupportTicket.exists({ ref, authUserId }))) {
      throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
    }
    throw new ApiError(409, "This request is full — open a new one", "TICKET_FULL");
  }
  if (log && comingBack) {
    await alertDesk(
      log,
      `Customer wrote again on ${ticket.ref}: ${ticket.subject}`,
      {
        ref: ticket.ref,
        username: ticket.username ?? "",
        email: ticket.email ?? "",
        category: ticket.category,
        assignee: ticket.assignee,
      },
      message,
    );
  }
  return forCustomer(ticket);
}

export const supportRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /* ---------------- the customer ---------------- */

  /** Their requests, most recent activity first. */
  app.get("/support/tickets", async (request) => {
    const { authUserId } = await authenticate(request);
    return { success: true, data: { tickets: await listMyTickets(authUserId) } };
  });

  app.post(
    "/support/tickets",
    { schema: { body: createBody }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request) => {
      const user = await authenticate(request);
      const ticket = await openTicket(
        { authUserId: user.authUserId, email: user.email, username: user.dbUser.username },
        request.body,
        request.log,
      );
      request.log.info({ ref: ticket.ref }, "support request opened");
      return { success: true, data: { ticket } };
    },
  );

  /** The customer writing again; a closed request opens back up. */
  app.post(
    "/support/tickets/:ref/messages",
    {
      schema: { params: z.object({ ref: ticketRef }), body: replyBody },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request) => {
      const { authUserId } = await authenticate(request);
      return {
        success: true,
        data: { ticket: await writeAgain(authUserId, request.params.ref, request.body.message, request.log) },
      };
    },
  );

  /* ---------------- the desk ---------------- */

  /**
   * The inbox: requests by status (and whose), with the counts. Waiting
   * requests come soonest-due first; the rest, newest activity first.
   * `me` is the asking admin's label, so the desk can say "You".
   */
  app.get("/admin/support", { schema: { querystring: deskListQuery } }, async (request) => {
    const actor = await requireAdmin(request);
    const { status, owner, search, offset } = request.query;
    const filter: Record<string, unknown> = status === "all" ? {} : { status };
    if (owner === "mine") filter.assignee = actor.label;
    if (owner === "unassigned") filter.assignee = { $in: ["", null] };
    if (search) {
      const term = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [{ ref: term }, { email: term }, { username: term }, { subject: term }];
    }
    const sort: Record<string, 1 | -1> = status === "open" ? { dueAt: 1, lastMessageAt: 1 } : { lastMessageAt: -1 };
    const waiting = { status: "open" as const };
    const [tickets, total, counts, mine, unassigned, overdue] = await Promise.all([
      SupportTicket.find(filter).sort(sort).skip(offset).limit(PAGE).lean<TicketDoc[]>(),
      SupportTicket.countDocuments(filter),
      SupportTicket.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      SupportTicket.countDocuments({ ...waiting, assignee: actor.label }),
      SupportTicket.countDocuments({ ...waiting, assignee: { $in: ["", null] } }),
      SupportTicket.countDocuments({ ...waiting, dueAt: { $lt: new Date() } }),
    ]);
    const count = (s: string) => counts.find((c) => c._id === s)?.n ?? 0;
    return {
      success: true,
      data: {
        tickets: tickets.map((t) => {
          const last = t.messages[t.messages.length - 1];
          return {
            ref: t.ref,
            authUserId: t.authUserId,
            email: t.email ?? "",
            username: t.username ?? "",
            category: t.category,
            subject: t.subject,
            status: t.status,
            assignee: t.assignee ?? "",
            dueAt: dueOf(t),
            createdAt: t.createdAt?.toISOString() ?? null,
            lastMessageAt: t.lastMessageAt.toISOString(),
            messageCount: t.messages.length,
            lastFrom: last?.from ?? "customer",
            preview: (last?.body ?? "").slice(0, 160),
          };
        }),
        total,
        counts: { open: count("open"), answered: count("answered"), closed: count("closed") },
        waiting: { mine, unassigned, overdue },
        me: actor.label,
        mailConfigured: isCustomerMailConfigured(),
      },
    };
  });

  /** One request in full, with the customer's account at a glance. */
  app.get(
    "/admin/support/:ref",
    { schema: { params: z.object({ ref: ticketRef }) } },
    async (request) => {
      await requireAdmin(request);
      const ticket = await SupportTicket.findOne({ ref: request.params.ref }).lean<TicketDoc>();
      if (!ticket) throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
      const [user, account, bets] = await Promise.all([
        User.findOne(
          { authUserId: ticket.authUserId },
          { createdAt: 1, suspendedAt: 1, suspendedReason: 1 },
        ).lean(),
        NairaAccount.findOne({ authUserId: ticket.authUserId }, { balanceKobo: 1 }).lean(),
        Position.countDocuments({ authUserId: ticket.authUserId }),
      ]);
      return {
        success: true,
        data: {
          ticket: forDesk(ticket),
          account: {
            joinedAt: user?.createdAt?.toISOString?.() ?? null,
            balanceKobo: account?.balanceKobo ?? 0,
            bets,
            suspendedAt: user?.suspendedAt?.toISOString() ?? null,
            suspendedReason: user?.suspendedReason ?? "",
          },
        },
      };
    },
  );

  /** Answer — added to the thread and emailed to the customer. */
  app.post(
    "/admin/support/:ref/reply",
    {
      schema: { params: z.object({ ref: ticketRef }), body: deskReplyBody },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const actor = await requireAdmin(request);
      const at = new Date();
      const ticket = await SupportTicket.findOneAndUpdate(
        { ref: request.params.ref, [`messages.${MAX_MESSAGES - 1}`]: { $exists: false } },
        {
          $push: { messages: { from: "support", body: request.body.message, by: actor.label, at } },
          $set: { status: request.body.close ? "closed" : "answered", lastMessageAt: at, dueAt: null },
        },
        { new: true },
      ).lean<TicketDoc>();
      if (!ticket) {
        if (!(await SupportTicket.exists({ ref: request.params.ref }))) {
          throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
        }
        throw new ApiError(409, "This request is full — ask the customer to open a new one", "TICKET_FULL");
      }
      // nobody had it: whoever answers owns it (only if still nobody's — a
      // colleague taking it a moment ago keeps it)
      if (!ticket.assignee) {
        const took = await SupportTicket.updateOne(
          { ref: ticket.ref, assignee: { $in: ["", null] } },
          { $set: { assignee: actor.label } },
        );
        if (took.modifiedCount === 1) ticket.assignee = actor.label;
      }

      const [emailed] = ticket.email
        ? await sendCustomerEmails(request.log, [
            {
              to: ticket.email,
              subject: `Re: ${ticket.subject} [${ticket.ref}]`,
              text: [
                `Hi ${ticket.username || "there"},`,
                "",
                request.body.message,
                "",
                "— WorldStreet Support",
                "",
                supportPageLine(ticket.ref),
              ].join("\n"),
            },
          ])
        : [false];
      return { success: true, data: { ticket: forDesk(ticket), emailed: emailed ?? false } };
    },
  );

  /** Close a request, or open it again. */
  app.post(
    "/admin/support/:ref/status",
    { schema: { params: z.object({ ref: ticketRef }), body: statusBody } },
    async (request) => {
      await requireAdmin(request);
      const reopening = request.body.status === "open";
      const current = await SupportTicket.findOne({ ref: request.params.ref }, { category: 1 }).lean();
      if (!current) throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
      const ticket = await SupportTicket.findOneAndUpdate(
        { ref: request.params.ref },
        // reopened, it waits on us again with a fresh reply-by time
        { $set: { status: request.body.status, dueAt: reopening ? dueFrom(current.category, new Date()) : null } },
        { new: true },
      ).lean<TicketDoc>();
      if (!ticket) throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
      return { success: true, data: { ticket: forDesk(ticket) } };
    },
  );

  /** Take a request ("me" — from anyone, so a colleague away can be covered), or put it back. */
  app.post(
    "/admin/support/:ref/assign",
    { schema: { params: z.object({ ref: ticketRef }), body: assignBody } },
    async (request) => {
      const actor = await requireAdmin(request);
      const ticket = await SupportTicket.findOneAndUpdate(
        { ref: request.params.ref },
        { $set: { assignee: request.body.to === "me" ? actor.label : "" } },
        { new: true },
      ).lean<TicketDoc>();
      if (!ticket) throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
      return { success: true, data: { ticket: forDesk(ticket) } };
    },
  );

  /* ---------------- saved replies ---------------- */

  const savedReplyView = (r: { _id: unknown; title: string; body: string; updatedBy?: string | null; updatedAt?: Date | null }) => ({
    id: String(r._id),
    title: r.title,
    body: r.body,
    updatedBy: r.updatedBy ?? "",
    updatedAt: r.updatedAt?.toISOString() ?? null,
  });

  /** The desk's saved replies, A to Z. */
  app.get("/admin/support/replies", async (request) => {
    await requireAdmin(request);
    const replies = await SupportReply.find().sort({ title: 1 }).limit(MAX_SAVED_REPLIES).lean();
    return { success: true, data: { replies: replies.map(savedReplyView) } };
  });

  app.post("/admin/support/replies", { schema: { body: savedReplyBody } }, async (request) => {
    const actor = await requireAdmin(request);
    if ((await SupportReply.countDocuments()) >= MAX_SAVED_REPLIES) {
      throw new ApiError(409, `There are already ${MAX_SAVED_REPLIES} saved replies — delete one first`, "TOO_MANY_REPLIES");
    }
    const reply = await SupportReply.create({ ...request.body, updatedBy: actor.label });
    return { success: true, data: { reply: savedReplyView(reply.toObject()) } };
  });

  app.put(
    "/admin/support/replies/:id",
    { schema: { params: savedReplyId, body: savedReplyBody } },
    async (request) => {
      const actor = await requireAdmin(request);
      const reply = await SupportReply.findByIdAndUpdate(
        request.params.id,
        { $set: { ...request.body, updatedBy: actor.label } },
        { new: true },
      ).lean();
      if (!reply) throw new ApiError(404, "That saved reply was deleted", "REPLY_NOT_FOUND");
      return { success: true, data: { reply: savedReplyView(reply) } };
    },
  );

  app.delete("/admin/support/replies/:id", { schema: { params: savedReplyId } }, async (request) => {
    await requireAdmin(request);
    await SupportReply.deleteOne({ _id: request.params.id });
    return { success: true, data: { deleted: true } };
  });
};
