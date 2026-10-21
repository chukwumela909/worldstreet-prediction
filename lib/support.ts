import { apiFetch } from "@/lib/api-client";

/**
 * The customer's side of the support desk (API: routes/support.ts). A
 * request is a thread: their first message, the desk's replies (each
 * also emailed to them) and anything they add. `ref` is the number both
 * sides quote.
 */

export type SupportStatus = "open" | "answered" | "closed";
export type SupportCategory = "money" | "bets" | "account" | "other";

export const SUPPORT_CATEGORIES: { key: SupportCategory; label: string }[] = [
  { key: "money", label: "Deposits & withdrawals" },
  { key: "bets", label: "A bet or market" },
  { key: "account", label: "My account" },
  { key: "other", label: "Something else" },
];

export interface SupportMessage {
  from: "customer" | "support";
  body: string;
  at: string;
}

export interface SupportTicket {
  ref: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  createdAt: string | null;
  lastMessageAt: string;
  messages: SupportMessage[];
}

export async function fetchMyTickets(): Promise<SupportTicket[]> {
  const res = await apiFetch<{ data: { tickets: SupportTicket[] } }>("/v1/support/tickets");
  return res.data.tickets;
}

export async function openTicket(body: {
  category: SupportCategory;
  subject: string;
  message: string;
}): Promise<SupportTicket> {
  const res = await apiFetch<{ data: { ticket: SupportTicket } }>("/v1/support/tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data.ticket;
}

/** Add to a request; a closed one opens again. */
export async function writeAgain(ref: string, message: string): Promise<SupportTicket> {
  const res = await apiFetch<{ data: { ticket: SupportTicket } }>(
    `/v1/support/tickets/${encodeURIComponent(ref)}/messages`,
    { method: "POST", body: JSON.stringify({ message }) },
  );
  return res.data.ticket;
}
