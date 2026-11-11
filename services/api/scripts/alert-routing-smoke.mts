/**
 * Where alerts go, and that each links to the thing itself: urgent ones
 * reach the paging list (PagerDuty) as well as the inbox, everything else
 * the inbox only, support notices the support list only; every email
 * carries a desk link; the desk's test alert and route report follow the
 * same rules. In-memory database, Resend answered here.
 *
 *   npx tsx scripts/alert-routing-smoke.mts
 */
const KEY = "smoke-routing-key-0123456789abcdefXYZ";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.ALERT_REPEAT_HOURS = "0";
process.env.ADMIN_ACCESS_KEYS = `josh:${KEY}`;
process.env.RESEND_API_KEY = "re_test";
process.env.ALERT_EMAIL_FROM = "WorldStreet <alerts@worldstreetgold.test>";
process.env.ALERT_EMAIL_TO = "desk@worldstreetgold.test";
process.env.ALERT_URGENT_EMAIL_TO = "oncall@worldstreet.pagerduty.test";
process.env.SUPPORT_EMAIL_TO = "support@worldstreetgold.test";
process.env.SITE_URL = "https://predict.worldstreetgold.test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { sendAlert } = await import("../src/alerts.js");
const { deskLink } = await import("../src/links.js");
const { buildApp } = await import("../src/app.js");
const { AlertRecord } = await import("../src/models.js");
const app = await buildApp();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
    console.log("  ✓", name);
  } else {
    failed += 1;
    console.log("  ✗", name);
  }
}
const log = { info() {}, warn() {}, error() {} } as unknown as import("fastify").FastifyBaseLogger;

// Resend, answered here
const sent: { to: string[]; subject: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com/")) {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "email" }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;
const last = () => sent[sent.length - 1]!;
const admin = (method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { "x-admin-key": KEY }, ...(payload !== undefined && { payload: payload as object }) });

console.log("urgent");
const urgent = await sendAlert(log, "Market at its loss limit", { market: "Final — Winner" }, {
  throttleKey: "risk:limit:critical:m1",
  kind: "risk",
  urgent: true,
  eventId: "e1",
  marketId: "m1",
  action: "Deal with it",
});
const urgentRow = await AlertRecord.findOne({ key: "risk:limit:critical:m1" }).lean();
check(
  "an urgent alert goes to the inbox and the paging list",
  urgent.urgent && urgent.recipients === 2 && last().to.includes("desk@worldstreetgold.test") &&
    last().to.includes("oncall@worldstreet.pagerduty.test"),
);
check("…tagged URGENT", last().subject === "[Worldstreet Local · URGENT] Market at its loss limit");
check(
  "…with a link to its own card on Today, right under what it is",
  urgentRow !== null &&
    last().text.split("\n")[2] === `Deal with it: https://predict.worldstreetgold.test/admin?alert=${String(urgentRow._id)}`,
);

console.log("regular");
const regular = await sendAlert(log, "Market overdue for resolution", { eventTitle: "Final" }, {
  throttleKey: "overdue:e2",
  kind: "settlement",
  eventId: "e2",
  action: "Settle it",
});
check(
  "a regular alert goes to the inbox only — it never pages",
  !regular.urgent && regular.recipients === 1 && last().to.length === 1 && last().to[0] === "desk@worldstreetgold.test",
);
check("…untagged", last().subject === "[Worldstreet Local] Market overdue for resolution");
check("…and links to its card too", last().text.includes("Settle it: https://predict.worldstreetgold.test/admin?alert="));

console.log("fault");
const fault = await sendAlert(log, "Money moved outside our records", { gap: "₦500" }, { kind: "fault" });
check("a fault always pages, whatever the caller says", fault.urgent && last().to.includes("oncall@worldstreet.pagerduty.test"));

console.log("withdrawal");
await sendAlert(log, "Withdrawal waiting for approval", { amount: "₦5,000" }, {
  throttleKey: "withdrawal-review:r1",
  kind: "withdrawal",
  link: deskLink.withdrawals("u-ada"),
  action: "Approve or reject it",
});
check(
  "a withdrawal links to that customer's withdrawals",
  last().text.includes("Approve or reject it: https://predict.worldstreetgold.test/admin/money?customer=u-ada"),
);

console.log("support");
const support = await sendAlert(log, "New support request WS-ABC234: Help", { request: "WS-ABC234" }, {
  kind: "support",
  link: deskLink.supportRequest("WS-ABC234"),
  action: "Reply",
});
check(
  "a support notice goes to the support list only",
  support.recipients === 1 && last().to.length === 1 && last().to[0] === "support@worldstreetgold.test" &&
    last().subject.startsWith("[Worldstreet Local · Support]"),
);
check(
  "…linking to that request",
  last().text.includes("Reply: https://predict.worldstreetgold.test/admin/customers/support?ref=WS-ABC234"),
);
check("…and isn't kept on the alerts list", (await AlertRecord.countDocuments({ subject: /support request/ })) === 0);

console.log("the desk's tests");
const sendTest = async (as?: string) =>
  (as === undefined ? await admin("POST", "/v1/admin/test-alert") : await admin("POST", "/v1/admin/test-alert", { as })).json() as {
    data: { email: string; recipients: number; urgent: boolean };
  };
const t1 = await sendTest("urgent");
check(
  "an urgent test pages, tagged as a test",
  t1.data.urgent && t1.data.recipients === 2 && last().subject === "[Worldstreet Local · URGENT · Test] Test urgent alert",
);
const t2 = await sendTest("regular");
check("a regular test reaches the inbox only", !t2.data.urgent && t2.data.recipients === 1 && last().subject === "[Worldstreet Local · Test] Test alert");
const t3 = await sendTest("support");
check(
  "a support test reaches the support list, linking to the inbox",
  t3.data.recipients === 1 && last().to[0] === "support@worldstreetgold.test" &&
    last().text.includes("https://predict.worldstreetgold.test/admin/customers/support"),
);
const t4 = await sendTest();
check("a bodyless test is a regular one, as before", t4.data.email === "sent" && t4.data.recipients === 1);
check("a made-up route is refused (400)", (await admin("POST", "/v1/admin/test-alert", { as: "carrier-pigeon" })).statusCode === 400);

const routes = (await admin("GET", "/v1/admin/alert-routes")).json() as {
  data: {
    emailConfigured: boolean;
    linksConfigured: boolean;
    exampleLink: string | null;
    routes: { regular: { recipients: number }; urgent: { recipients: number; pagingList: number }; support: { recipients: number; ownList: boolean } };
  };
};
check(
  "the route report counts each list, with no addresses in it",
  routes.data.emailConfigured && routes.data.linksConfigured && routes.data.exampleLink === "https://predict.worldstreetgold.test/admin" &&
    routes.data.routes.regular.recipients === 1 && routes.data.routes.urgent.recipients === 2 &&
    routes.data.routes.urgent.pagingList === 1 && routes.data.routes.support.ownList &&
    !JSON.stringify(routes.data).includes("@"),
);

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
