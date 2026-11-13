/**
 * Cursor keeps no token history on disk, so its usage is the account's billed
 * events from Cursor's dashboard API. The last good read is saved in the Argus
 * home so the screen keeps its totals offline, and only the recent tail is
 * fetched again.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../../lib/argusHome";
import { tokenCount, type UsageRecord } from "../records";
import { CURSOR_API, cursorAccessToken } from "./cursorAuth";

export const CURSOR_RUNNER_ID = "cursor";

const FRESH_MS = 60_000;
/** Events can be finalized after they were first read. */
const REFETCH_OVERLAP_MS = 60 * 60_000;
/** Longer than the widest range the screen shows. */
const KEEP_MS = 100 * 24 * 60 * 60_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_VERSION = 1;

interface AccountCache {
  version: number;
  /** Hash of the account the records belong to; a different sign-in starts over. */
  accountKey: string;
  sinceMs: number;
  untilMs: number;
  fetchedAt: number;
  records: UsageRecord[];
}

export interface CursorUsageDeps {
  token: () => Promise<string | null>;
  fetch: typeof fetch;
  cacheFile: string;
  now: () => number;
}

const defaultDeps = (): CursorUsageDeps => ({
  token: cursorAccessToken,
  fetch: (input, init) => fetch(input, init),
  cacheFile: path.join(argusHomeDir(), "usage-cursor-account.json"),
  now: Date.now,
});

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const sha = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);

/** The JWT's subject, hashed; the token itself rotates. */
function accountKeyOf(token: string): string {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    if (isRecord(payload) && typeof payload.sub === "string" && payload.sub) {
      return sha(payload.sub);
    }
  } catch {
    // Not a JWT.
  }

  return "unknown";
}

function readCache(file: string): AccountCache | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      isRecord(parsed) &&
      parsed.version === CACHE_VERSION &&
      typeof parsed.accountKey === "string" &&
      typeof parsed.sinceMs === "number" &&
      typeof parsed.untilMs === "number" &&
      typeof parsed.fetchedAt === "number" &&
      Array.isArray(parsed.records)
    ) {
      return parsed as unknown as AccountCache;
    }
  } catch {
    // Missing or corrupt: fetch afresh.
  }

  return null;
}

function writeCache(file: string, cache: AccountCache): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // Kept in memory; the next read writes it again.
  }
}

/** Raw dashboard events in the window, or null when the read failed or came back inconsistent. */
async function fetchEvents(
  token: string,
  sinceMs: number,
  untilMs: number,
  deps: CursorUsageDeps,
): Promise<Json[] | null> {
  const pages: Json[][] = [];
  let total: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await deps.fetch(
      `${CURSOR_API}/aiserver.v1.DashboardService/GetFilteredUsageEvents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "connect-protocol-version": "1",
        },
        body: JSON.stringify({
          page,
          pageSize: PAGE_SIZE,
          startDate: String(sinceMs),
          endDate: String(untilMs),
        }),
        // A redirect must never carry the token elsewhere.
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      return null;
    }
    const body: unknown = await res.json();
    if (!isRecord(body)) {
      return null;
    }
    const count = body.totalUsageEventsCount;
    if (typeof count === "number") {
      if (total !== null && count !== total) {
        return null;
      }
      total = count;
    }
    const events = Array.isArray(body.usageEventsDisplay)
      ? body.usageEventsDisplay.filter(isRecord)
      : [];
    pages.push(events);
    if (events.length < PAGE_SIZE) {
      return dropPageOverlaps(pages, total);
    }
  }

  return null;
}

/**
 * Events arriving mid-read shift later pages, repeating a previous page's tail
 * at the next page's head. The count says how many repeats to drop.
 */
function dropPageOverlaps(
  pages: Json[][],
  total: number | null,
): Json[] | null {
  const raw = pages.reduce((n, p) => n + p.length, 0);
  if (total === null) {
    return pages.flat();
  }
  let excess = raw - total;
  if (excess < 0) {
    return null;
  }
  const out = [...pages[0]];
  for (let i = 1; i < pages.length; i++) {
    const prev = pages[i - 1].map((e) => JSON.stringify(e));
    const cur = pages[i].map((e) => JSON.stringify(e));
    let overlap = 0;
    for (let k = Math.min(excess, prev.length, cur.length); k > 0; k--) {
      if (cur.slice(0, k).every((e, j) => e === prev[prev.length - k + j])) {
        overlap = k;
        break;
      }
    }
    excess -= overlap;
    out.push(...pages[i].slice(overlap));
  }

  return excess === 0 ? out : null;
}

/** Records with keys stable across reads of the same window, so overlapping fetches never count twice. */
export function cursorRecords(
  events: Json[],
  accountKey: string,
): UsageRecord[] {
  const occurrences = new Map<string, number>();
  const out: UsageRecord[] = [];
  for (const event of events) {
    const usage = isRecord(event.tokenUsage) ? event.tokenUsage : null;
    const at = Number(event.timestamp);
    const model = typeof event.model === "string" ? event.model : "";
    if (!usage || !Number.isFinite(at) || !model) {
      continue;
    }
    const sessionId =
      typeof event.conversationId === "string" ? event.conversationId : "";
    const tokens = {
      input: tokenCount(usage.inputTokens),
      cacheRead: tokenCount(usage.cacheReadTokens),
      cacheWrite: tokenCount(usage.cacheWriteTokens),
      output: tokenCount(usage.outputTokens),
    };
    const cents =
      typeof usage.totalCents === "number" && Number.isFinite(usage.totalCents)
        ? Math.max(0, usage.totalCents)
        : null;
    // Events carry no id; identical rows stay apart by their occurrence.
    const identity = sha(JSON.stringify([at, model, sessionId, tokens, cents]));
    const n = occurrences.get(identity) ?? 0;
    occurrences.set(identity, n + 1);
    out.push({
      at,
      runner: CURSOR_RUNNER_ID,
      model,
      sessionId,
      key: `${accountKey}:${identity}:${n}`,
      input: tokens.input,
      cacheRead: tokens.cacheRead,
      cacheWrite5m: tokens.cacheWrite,
      cacheWrite1h: 0,
      output: tokens.output,
      costUsd: cents === null ? null : cents / 100,
      ...(/-fast$/.test(model) ? { speed: "fast" as const } : {}),
    });
  }

  return out;
}

let state: { file: string; cache: AccountCache | null } | null = null;
let lastFailureAt = -Infinity;
let inflight: Promise<AccountCache | null> | null = null;

async function refresh(
  sinceMs: number,
  deps: CursorUsageDeps,
): Promise<AccountCache | null> {
  const now = deps.now();
  const cache = state?.cache ?? null;
  if (cache && cache.sinceMs <= sinceMs && now - cache.fetchedAt < FRESH_MS) {
    return cache;
  }
  if (now - lastFailureAt < FRESH_MS) {
    return cache;
  }
  const token = await deps.token();
  if (!token) {
    lastFailureAt = now;

    return cache;
  }
  const accountKey = accountKeyOf(token);
  const base = cache?.accountKey === accountKey ? cache : null;
  const tailOnly =
    base !== null &&
    base.sinceMs <= sinceMs &&
    base.untilMs - REFETCH_OVERLAP_MS >= base.sinceMs;
  const from = tailOnly ? base.untilMs - REFETCH_OVERLAP_MS : sinceMs;
  let events: Json[] | null;
  try {
    events = await fetchEvents(token, from, now, deps);
  } catch {
    events = null;
  }
  if (!events) {
    lastFailureAt = now;

    return cache;
  }
  const fetched = cursorRecords(events, accountKey).filter(
    (r) => r.at >= from && r.at <= now,
  );
  const kept = tailOnly
    ? base.records.filter((r) => r.at < from && r.at >= now - KEEP_MS)
    : [];
  const next: AccountCache = {
    version: CACHE_VERSION,
    accountKey,
    sinceMs: tailOnly ? Math.max(base.sinceMs, now - KEEP_MS) : from,
    untilMs: now,
    fetchedAt: now,
    records: [...kept, ...fetched],
  };
  if (state) {
    state.cache = next;
  }
  writeCache(deps.cacheFile, next);

  return next;
}

/** The account's billed calls at or after `sinceMs`; saved ones when Cursor can't be reached. */
export async function loadCursorUsageRecords(
  sinceMs: number,
  deps: CursorUsageDeps = defaultDeps(),
): Promise<UsageRecord[]> {
  try {
    if (state?.file !== deps.cacheFile) {
      state = { file: deps.cacheFile, cache: readCache(deps.cacheFile) };
    }
    inflight ??= refresh(sinceMs, deps).finally(() => {
      inflight = null;
    });
    const cache = await inflight;

    return cache ? cache.records.filter((r) => r.at >= sinceMs) : [];
  } catch {
    return [];
  }
}

/** Test seam. */
export function resetCursorUsageCache(): void {
  state = null;
  lastFailureAt = -Infinity;
  inflight = null;
}
