import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { authenticate } from "./auth.js";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

/**
 * Who may use the admin desk, and who did what there.
 *
 * Two ways in:
 *  - an access key from ADMIN_ACCESS_KEYS, sent as the `X-Admin-Key`
 *    header — the desk's own unlock form stores it for the tab;
 *  - the central Clerk role (publicMetadata.role === "admin"), the same
 *    signal the rest of WorldStreet uses.
 * Keys are the interim way in. Emptying ADMIN_ACCESS_KEYS turns them off
 * and leaves the Clerk role alone, which is the revert.
 *
 * A request that presents a key is judged on the key alone: a wrong key
 * is refused even if the same browser also has a Clerk session, so a
 * revoked key fails loudly rather than falling through.
 */

export interface AdminActor {
  /** What the audit trail records: `key:<name>`, or the Clerk user id. */
  id: string;
  /** Human label for logs and the settings change log. */
  label: string;
  via: "key" | "clerk";
}

export const ADMIN_KEY_HEADER = "x-admin-key";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * The key's owner, or null. Every configured key is compared, in
 * constant time and without stopping at a match, so neither timing nor
 * a key's position reveals anything.
 */
export function matchAccessKey(
  presented: string,
  keys: readonly { name: string; key: string }[] = config.adminAccessKeys,
): string | null {
  const given = digest(presented);
  let owner: string | null = null;
  for (const { name, key } of keys) {
    if (timingSafeEqual(given, digest(key)) && owner === null) owner = name;
  }
  return owner;
}

export async function requireAdmin(request: FastifyRequest): Promise<AdminActor> {
  const header = request.headers[ADMIN_KEY_HEADER];
  const presented = Array.isArray(header) ? header[0] : header;
  if (presented) {
    const name = config.adminAccessKeys.length > 0 ? matchAccessKey(presented) : null;
    if (!name) {
      request.log.warn({ ip: request.ip }, "admin access key refused");
      throw new ApiError(401, "That access key isn't valid", "INVALID_ADMIN_KEY");
    }
    return { id: `key:${name}`, label: `key:${name}`, via: "key" };
  }

  const user = await authenticate(request);
  if (user.role !== "admin") {
    throw new ApiError(403, "Admin access required", "FORBIDDEN");
  }
  return { id: user.authUserId, label: user.email || user.authUserId, via: "clerk" };
}
