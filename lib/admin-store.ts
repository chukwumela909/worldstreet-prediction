"use client";

import { useSyncExternalStore } from "react";
import type { Category } from "@/types/market";

/**
 * Mock admin store (no backend), same pattern as portfolio-store:
 * admin-created drafts, status overrides, resolutions, and the audit
 * log live in localStorage and are shared app-wide via
 * useSyncExternalStore. UI/flow demo only — the public site does not
 * read this store.
 */

/** Market lifecycle: Draft → Live → (Paused) → Closed → Resolving → Resolved. */
export type MarketStatus =
  | "draft"
  | "live"
  | "paused"
  | "closed"
  | "resolving"
  | "resolved";

export interface AdminOutcome {
  /** Outcome label ("Yes" for binary, "Spain" for multi). */
  label: string;
  /** Initial Yes-probability in whole percent, 1–99. */
  yesPct: number;
}

/** An event authored in the admin (kept separate from fixtures). */
export interface AdminEvent {
  /** Prefixed "adm-" so ids can never collide with fixture ids. */
  id: string;
  slug: string;
  title: string;
  icon: string;
  category: Category;
  /** ISO date the event resolves/ends. */
  endDate: string;
  /** One row per outcome; a single row means a binary Yes/No market. */
  outcomes: AdminOutcome[];
  resolutionRules: string;
  status: MarketStatus;
  createdAt: number;
}

export interface Resolution {
  /** Winning outcome label ("Yes"/"No" for binary). */
  outcome: string;
  evidenceUrl?: string;
  ts: number;
  actor: string;
}

export interface AuditEntry {
  id: string;
  ts: number;
  /** Admin user name/email who performed the action. */
  actor: string;
  /** Verb phrase, e.g. "Paused market". */
  action: string;
  /** What it was done to, e.g. the event title. */
  subject: string;
  detail?: string;
}

/** Homepage curation config (UI demo — the public site keeps its fixtures). */
export interface ContentConfig {
  /** Slug of the event driving the hero's featured market slide. */
  heroFeaturedSlug: string;
  /** Hero rotation, in display order. */
  heroSlides: { key: "market" | "game" | "btc"; enabled: boolean }[];
  /** Promo-rail "Hot topics" ranked list (rank = position). */
  hotTopics: { name: string; volumeToday: string }[];
}

export const DEFAULT_CONTENT: ContentConfig = {
  heroFeaturedSlug: "world-cup-winner",
  heroSlides: [
    { key: "market", enabled: true },
    { key: "game", enabled: true },
    { key: "btc", enabled: true },
  ],
  hotTopics: [
    { name: "Argentina", volumeToday: "$51M" },
    { name: "England", volumeToday: "$47M" },
    { name: "Ballon d'Or", volumeToday: "$970K" },
    { name: "Messi", volumeToday: "$13M" },
    { name: "Orbán", volumeToday: "$324K" },
  ],
};

export interface AdminState {
  created: AdminEvent[];
  /** Lifecycle overrides for fixture events, keyed by event id. */
  statusOverrides: Record<string, MarketStatus>;
  /** Resolutions keyed by event id (fixture or admin-created). */
  resolutions: Record<string, Resolution>;
  content: ContentConfig;
  audit: AuditEntry[];
}

const DEFAULT_STATE: AdminState = {
  created: [],
  statusOverrides: {},
  resolutions: {},
  content: DEFAULT_CONTENT,
  audit: [],
};

const STORAGE_KEY = "ws-admin";

let state: AdminState = DEFAULT_STATE;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...DEFAULT_STATE, ...(JSON.parse(raw) as AdminState) };
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }
}

function commit(next: AdminState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — state still lives in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function withAudit(
  next: Omit<AdminState, "audit">,
  actor: string,
  action: string,
  subject: string,
  detail?: string,
) {
  commit({
    ...next,
    audit: [
      { id: newId("aud"), ts: Date.now(), actor, action, subject, detail },
      ...state.audit,
    ],
  });
}

/** Fields the authoring form edits on an AdminEvent. */
export type AdminEventFields = Omit<AdminEvent, "id" | "status" | "createdAt">;

/** Create a market from the authoring form as a draft or straight to live. */
export function createEvent(
  fields: AdminEventFields,
  status: "draft" | "live",
  actor: string,
): string {
  load();
  const id = newId("adm");
  const event: AdminEvent = { ...fields, id, status, createdAt: Date.now() };
  withAudit(
    { ...state, created: [event, ...state.created] },
    actor,
    status === "draft" ? "Saved draft" : "Published market",
    fields.title,
  );
  return id;
}

/** Update an admin-created event; optionally move draft → live (publish). */
export function updateEvent(
  id: string,
  fields: AdminEventFields,
  status: MarketStatus,
  actor: string,
) {
  load();
  const prev = state.created.find((e) => e.id === id);
  if (!prev) return;
  withAudit(
    {
      ...state,
      created: state.created.map((e) =>
        e.id === id ? { ...e, ...fields, status } : e,
      ),
    },
    actor,
    prev.status === "draft" && status === "live"
      ? "Published market"
      : "Edited market",
    fields.title,
  );
}

/** Delete an admin-created event (drafts and mistakes). */
export function deleteEvent(id: string, actor: string) {
  load();
  const prev = state.created.find((e) => e.id === id);
  if (!prev) return;
  withAudit(
    { ...state, created: state.created.filter((e) => e.id !== id) },
    actor,
    "Deleted market",
    prev.title,
  );
}

/** Undo a resolution (mis-resolve): back to closed, awaiting outcome. */
export function unresolveEvent(eventId: string, eventTitle: string, actor: string) {
  load();
  const { [eventId]: _dropped, ...resolutions } = state.resolutions;
  withAudit(
    {
      ...state,
      created: state.created.map((e) =>
        e.id === eventId ? { ...e, status: "closed" as const } : e,
      ),
      statusOverrides: { ...state.statusOverrides, [eventId]: "closed" },
      resolutions,
    },
    actor,
    "Reopened resolution",
    eventTitle,
  );
}

/** Change lifecycle status of an admin-created event (publish, pause…). */
export function setCreatedStatus(
  id: string,
  status: MarketStatus,
  actor: string,
) {
  load();
  const prev = state.created.find((e) => e.id === id);
  if (!prev) return;
  withAudit(
    {
      ...state,
      created: state.created.map((e) => (e.id === id ? { ...e, status } : e)),
    },
    actor,
    prev.status === "draft" && status === "live"
      ? "Published market"
      : `Set status to ${status}`,
    prev.title,
  );
}

/** Replace the homepage curation config (one audit entry per save). */
export function setContent(content: ContentConfig, actor: string, detail?: string) {
  load();
  withAudit(
    { ...state, content },
    actor,
    "Updated homepage content",
    "Featured hero & promo rail",
    detail,
  );
}

/** "Will BTC hit $200k?" → "will-btc-hit-200k". */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Override a fixture event's lifecycle status (pause, close, reopen…). */
export function setEventStatus(
  eventId: string,
  eventTitle: string,
  status: MarketStatus,
  actor: string,
) {
  load();
  withAudit(
    { ...state, statusOverrides: { ...state.statusOverrides, [eventId]: status } },
    actor,
    `Set status to ${status}`,
    eventTitle,
  );
}

/** Record the winning outcome for an event and mark it resolved. */
export function resolveEvent(
  eventId: string,
  eventTitle: string,
  outcome: string,
  actor: string,
  evidenceUrl?: string,
) {
  load();
  withAudit(
    {
      ...state,
      created: state.created.map((e) =>
        e.id === eventId ? { ...e, status: "resolved" as const } : e,
      ),
      statusOverrides: { ...state.statusOverrides, [eventId]: "resolved" },
      resolutions: {
        ...state.resolutions,
        [eventId]: { outcome, evidenceUrl, ts: Date.now(), actor },
      },
    },
    actor,
    `Resolved as "${outcome}"`,
    eventTitle,
    evidenceUrl,
  );
}

/**
 * Effective lifecycle status for any event: explicit override first,
 * else derived — past its end date means trading is closed.
 */
export function effectiveStatus(
  eventId: string,
  endDate: string,
  now: number,
): MarketStatus {
  load();
  const override = state.statusOverrides[eventId];
  if (override) return override;
  if (state.resolutions[eventId]) return "resolved";
  return Date.parse(endDate) < now ? "closed" : "live";
}

export function useAdminState(): AdminState {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => DEFAULT_STATE,
  );
}
