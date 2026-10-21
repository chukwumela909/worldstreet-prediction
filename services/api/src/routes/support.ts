import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAdmin } from "../admin-auth.js";
import { authenticate } from "../auth.js";
import { isCustomerMailConfigured, sendCustomerEmails } from "../customer-mail.js";
import { ApiError } from "../errors.js";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  SupportTicket,
  User,
  type ISupportTicket,
} from "../models.js";
import { NairaAccount, Position } from "../trading/models.js";

/**
 * The support desk. A signed-in customer opens a request (a category, a
 * subject, their message) from the site's Support page and follows the
 * thread there; the desk reads every request under Admin → Support,
 * replies — each reply is emailed to the customer as well — and closes it.
 * A customer writing again reopens a closed request.
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
  search: z.string().trim().max(120).optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

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
> & { createdAt?: Date | null };

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
    messages: t.messages.map((m) => ({
      from: m.from,
      body: m.body,
      by: m.by ?? "",
      at: m.at.toISOString(),
    })),
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
 * The customer's side as plain functions — what the routes run after
 * sign-in, exported so the smoke tests can drive them without Clerk.
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
  };
  // a clash on the six-character number is rare; try a fresh one
  for (let attempt = 0; ; attempt++) {
    try {
      const ticket = await SupportTicket.create({ ...fields, ref: newRef() });
      return forCustomer(ticket.toObject());
    } catch (err) {
      const dup = err && typeof err === "object" && "code" in err && err.code === 11000;
      if (!dup || attempt >= 4) throw err;
    }
  }
}

export async function writeAgain(authUserId: string, ref: string, message: string) {
  const at = new Date();
  const ticket = await SupportTicket.findOneAndUpdate(
    { ref, authUserId, [`messages.${MAX_MESSAGES - 1}`]: { $exists: false } },
    {
      $push: { messages: { from: "customer", body: message, by: "", at } },
      $set: { status: "open", lastMessageAt: at },
    },
    { new: true },
  ).lean<TicketDoc>();
  if (!ticket) {
    if (!(await SupportTicket.exists({ ref, authUserId }))) {
      throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
    }
    throw new ApiError(409, "This request is full — open a new one", "TICKET_FULL");
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
        data: { ticket: await writeAgain(authUserId, request.params.ref, request.body.message) },
      };
    },
  );

  /* ---------------- the desk ---------------- */

  /** The inbox: requests by status, newest activity first, with the counts. */
  app.get("/admin/support", { schema: { querystring: deskListQuery } }, async (request) => {
    await requireAdmin(request);
    const { status, search, offset } = request.query;
    const filter: Record<string, unknown> = status === "all" ? {} : { status };
    if (search) {
      const term = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [{ ref: term }, { email: term }, { username: term }, { subject: term }];
    }
    const [tickets, total, counts] = await Promise.all([
      SupportTicket.find(filter).sort({ lastMessageAt: -1 }).skip(offset).limit(PAGE).lean<TicketDoc[]>(),
      SupportTicket.countDocuments(filter),
      SupportTicket.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
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
            createdAt: t.createdAt?.toISOString() ?? null,
            lastMessageAt: t.lastMessageAt.toISOString(),
            messageCount: t.messages.length,
            lastFrom: last?.from ?? "customer",
            preview: (last?.body ?? "").slice(0, 160),
          };
        }),
        total,
        counts: { open: count("open"), answered: count("answered"), closed: count("closed") },
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
          $set: { status: request.body.close ? "closed" : "answered", lastMessageAt: at },
        },
        { new: true },
      ).lean<TicketDoc>();
      if (!ticket) {
        if (!(await SupportTicket.exists({ ref: request.params.ref }))) {
          throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
        }
        throw new ApiError(409, "This request is full — ask the customer to open a new one", "TICKET_FULL");
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
                `To reply, open Support on WorldStreet Predict and find request ${ticket.ref}.`,
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
      const ticket = await SupportTicket.findOneAndUpdate(
        { ref: request.params.ref },
        { $set: { status: request.body.status } },
        { new: true },
      ).lean<TicketDoc>();
      if (!ticket) throw new ApiError(404, "No such request", "TICKET_NOT_FOUND");
      return { success: true, data: { ticket: forDesk(ticket) } };
    },
  );
};
