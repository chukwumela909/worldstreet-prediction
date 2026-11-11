import { config } from "./config.js";

/**
 * Links into the web app, in one place — so every alert email, webhook
 * and customer email agrees on where things live, and a desk page that
 * moves is fixed here once.
 *
 * A desk link is the admin path that opens the exact item (the desk
 * pages read these query parameters and scroll to it, highlighted)
 * plus the menu route that names it, for when SITE_URL isn't set: an
 * email still says where to go, it just can't be pressed.
 */

export interface DeskLink {
  /** e.g. "/admin/customers/support?ref=WS-7K2M9Q" */
  path: string;
  /** e.g. "Admin → Customers → Support" */
  where: string;
}

const q = encodeURIComponent;

export const deskLink = {
  /** An alert's card on Today, with the fix on it (settle, suspend, reprice). */
  alert: (id: string): DeskLink => ({ path: `/admin?alert=${q(id)}`, where: "Admin → Today" }),
  /** Today itself, for an alert whose record couldn't be kept. */
  today: (): DeskLink => ({ path: "/admin", where: "Admin → Today" }),
  /** The support inbox itself. */
  supportInbox: (): DeskLink => ({ path: "/admin/customers/support", where: "Admin → Inbox → Support" }),
  /** One support request, opened. */
  supportRequest: (ref: string): DeskLink => ({
    path: `/admin/customers/support?ref=${q(ref)}`,
    where: `Admin → Customers → Support (${ref})`,
  }),
  /** One customer's withdrawals, with the approve and return buttons. */
  withdrawals: (authUserId: string): DeskLink => ({
    path: `/admin/money?customer=${q(authUserId)}`,
    where: "Admin → Money → Withdrawals",
  }),
};

/** An absolute URL on the web app, or null without SITE_URL. */
export function siteUrl(path: string): string | null {
  if (!config.SITE_URL) return null;
  try {
    return new URL(path, config.SITE_URL).toString();
  } catch {
    return null; // a mistyped SITE_URL mustn't break the email it's in
  }
}

/** "Reply: https://…/admin/customers/support?ref=WS-…", or "Reply: Admin → Customers → Support (WS-…)". */
export function deskLine(action: string, link: DeskLink): string {
  return `${action}: ${siteUrl(link.path) ?? link.where}`;
}
