/**
 * Admin access keys: config parsing (good and bad), matching, and the
 * requireAdmin gate for a request carrying a key. No database, no Clerk.
 *
 *   npx tsx scripts/admin-keys-smoke.mts
 */
import { randomBytes } from "node:crypto";

// fresh throwaway keys every run — never a literal that could be mistaken
// for (or reused as) a real one
const JOSH = randomBytes(24).toString("base64url"); // 32 chars
const WISDOM = randomBytes(27).toString("base64url"); // 36 chars

process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.ADMIN_ACCESS_KEYS = `josh:${JOSH}, wisdom:${WISDOM}`;

const { config } = await import("../src/config.js");
const { matchAccessKey, requireAdmin } = await import("../src/admin-auth.js");
const { ApiError } = await import("../src/errors.js");

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

/* ---------------- config ---------------- */
console.log("config");
check("two named keys parsed", config.adminAccessKeys.length === 2 && config.adminAccessKeys[1]?.name === "wisdom");

// the parser runs at import, so bad values are checked in a fresh process
const { spawnSync } = await import("node:child_process");
function bootsWith(keys: string): boolean {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", "await import('./src/config.ts')"],
    {
      env: { ...process.env, ADMIN_ACCESS_KEYS: keys },
      encoding: "utf8",
      shell: false,
    },
  );
  return r.status === 0;
}
check("empty keys boot (key access off)", bootsWith(""));
check("a short key stops the boot", !bootsWith("josh:tooShort"));
check("a nameless entry stops the boot", !bootsWith(JOSH));
check("a repeated name stops the boot", !bootsWith(`josh:${JOSH},JOSH:${WISDOM}`));

/* ---------------- matching ---------------- */
console.log("matching");
check("a valid key names its owner", matchAccessKey(JOSH) === "josh" && matchAccessKey(WISDOM) === "wisdom");
check("a wrong key matches nobody", matchAccessKey(JOSH.slice(0, -1) + "x") === null);
check("a prefix of a key matches nobody", matchAccessKey(JOSH.slice(0, 16)) === null);
check("no keys configured matches nothing", matchAccessKey(JOSH, []) === null);

/* ---------------- the gate ---------------- */
console.log("requireAdmin");
const log = { warn() {}, info() {}, error() {} };
const req = (key?: string) =>
  ({ headers: key === undefined ? {} : { "x-admin-key": key }, log, ip: "127.0.0.1" }) as never;

const actor = await requireAdmin(req(WISDOM));
check("a valid key is an admin, audited by name", actor.via === "key" && actor.id === "key:wisdom");

let refused: string | null = null;
try {
  await requireAdmin(req("not-the-key-" + "x".repeat(30)));
} catch (err) {
  refused = err instanceof ApiError ? `${err.statusCode}:${err.code}` : "other";
}
check("a wrong key is refused with 401 INVALID_ADMIN_KEY", refused === "401:INVALID_ADMIN_KEY");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
