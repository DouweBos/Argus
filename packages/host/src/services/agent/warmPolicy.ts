/**
 * Which sessions keep a warm spare. Clients only say which session they're
 * looking at (`set_viewing_session`, gateway `sessions.viewing`); the host
 * warms the most recently viewed ready sessions, up to `maxSpares`, and lets a
 * spare nobody looks at any more go after `spareIdleMs`.
 */

import type { NewSpare } from "./spares";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import {
  getClaudeAccount,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import {
  currentConnectionId,
  onConnectionClose,
} from "../remote/connectionScope";
import { sessionRunnerId } from "../session/models";
import {
  clearSpares,
  discardSpare,
  fillSpare,
  getSpare,
  isFilling,
  onSpareEvent,
  spareSessionIds,
} from "./spares";

export const DEFAULT_SPARE_IDLE_MS = 5 * 60_000;

interface Viewer {
  sessionId: string;
  /** The runner the viewer's start composer has picked; null for the session's. */
  runnerId: string | null;
}

interface PolicyOptions {
  maxSpares: () => number;
  spareIdleMs: number;
  /** `spawnSpare`, handed in by boot: the agent service reaches back here through the gateway. */
  spawn: (sessionId: string, runnerId?: string) => Promise<NewSpare>;
}

const viewers = new Map<string, Viewer>();
const lastViewedAt = new Map<string, number>();
/** Sessions whose last spawn failed; retried once a viewer arrives anew. */
const failed = new Set<string>();
let options: Omit<PolicyOptions, "spawn"> & Partial<PolicyOptions> = {
  maxSpares: () => 1,
  spareIdleMs: DEFAULT_SPARE_IDLE_MS,
};
let running = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let teardown: (() => void)[] = [];

/**
 * Record what one client is looking at. Keyed by its gateway / local-socket
 * connection, which clears it on disconnect; the Electron renderer, which has
 * none, names itself with `viewerId`.
 */
export function setViewingSession(
  sessionId: string | null,
  opts: { viewerId?: string | null; runnerId?: string | null } = {},
): void {
  const connectionId = currentConnectionId();
  const key = connectionId ?? `local:${opts.viewerId ?? "default"}`;
  const before = viewers.get(key);
  if (before) {
    lastViewedAt.set(before.sessionId, Date.now());
  } else if (connectionId) {
    onConnectionClose(() => forgetViewer(key));
  }
  if (!sessionId) {
    viewers.delete(key);
    reconcile();

    return;
  }
  if (before?.sessionId !== sessionId) {
    failed.delete(sessionId);
  }
  viewers.set(key, { sessionId, runnerId: opts.runnerId ?? null });
  lastViewedAt.set(sessionId, Date.now());
  reconcile();
}

function forgetViewer(key: string): void {
  const viewer = viewers.get(key);
  if (!viewer) {
    return;
  }
  viewers.delete(key);
  lastViewedAt.set(viewer.sessionId, Date.now());
  reconcile();
}

/** Viewed sessions, most recently viewed first, with the runner to warm. */
function viewedSessions(): Map<string, string | null> {
  const byRecency = [...viewers.values()].sort(
    (a, b) =>
      (lastViewedAt.get(b.sessionId) ?? 0) -
      (lastViewedAt.get(a.sessionId) ?? 0),
  );
  const viewed = new Map<string, string | null>();
  for (const v of byRecency) {
    if (!viewed.has(v.sessionId)) {
      viewed.set(v.sessionId, v.runnerId);
    }
  }

  return viewed;
}

/** Ready, and on an account with quota left: a spare there would only fail its first prompt. */
function warmable(sessionId: string): boolean {
  const session = appState.sessions.get(sessionId);
  if (!session || session.status !== "ready" || !session.path) {
    return false;
  }
  const account = getClaudeAccount(resolveAccountForSession(session));

  return account?.rate_limited !== true;
}

function canWarm(sessionId: string): boolean {
  return warmable(sessionId) && !failed.has(sessionId);
}

/** The runner a spare for this session should run: the viewer's pick, else the session's. */
function wantedRunner(sessionId: string, picked: string | null): string {
  const session = appState.sessions.get(sessionId);

  return picked ?? (session ? sessionRunnerId(session) : "claude-code");
}

function warmSessions(): string[] {
  return [...new Set([...spareSessionIds(), ...fillingSessions()])];
}

function fillingSessions(): string[] {
  return [...appState.sessions.keys()].filter(isFilling);
}

/** Bring the pool in line with who is looking at what. */
export function reconcile(): void {
  const { spawn } = options;
  if (!running || !spawn) {
    return;
  }
  const viewed = viewedSessions();
  const cap = Math.max(0, options.maxSpares());
  const targets = [...viewed.keys()].filter(canWarm).slice(0, cap);

  for (const sessionId of warmSessions()) {
    const spare = getSpare(sessionId);
    if (!warmable(sessionId)) {
      discardSpare(sessionId, "session");
    } else if (viewed.has(sessionId) && !targets.includes(sessionId)) {
      discardSpare(sessionId, "evicted");
    } else if (
      spare &&
      viewed.has(sessionId) &&
      spare.agent.runner.id !==
        wantedRunner(sessionId, viewed.get(sessionId) ?? null)
    ) {
      discardSpare(sessionId, "runner");
    }
  }

  // Spares nobody views go oldest-viewed first when a target needs room.
  const idle = warmSessions()
    .filter((id) => !viewed.has(id))
    .sort((a, b) => (lastViewedAt.get(a) ?? 0) - (lastViewedAt.get(b) ?? 0));
  const missing = targets.filter((id) => !getSpare(id) && !isFilling(id));
  let free = cap - warmSessions().length;
  while (free < missing.length && idle.length > 0) {
    discardSpare(idle.shift()!, "evicted");
    free += 1;
  }
  for (const sessionId of missing.slice(0, Math.max(0, free))) {
    const runnerId = viewed.get(sessionId) ?? undefined;
    fillSpare(sessionId, () => spawn(sessionId, runnerId)).catch((e: unknown) =>
      warn(`[spares] fill failed: ${String(e)}`),
    );
  }

  scheduleIdleDrop(idle);
}

function scheduleIdleDrop(idle: string[]): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const now = Date.now();
  let next = Infinity;
  for (const sessionId of idle) {
    const due = (lastViewedAt.get(sessionId) ?? 0) + options.spareIdleMs;
    if (due <= now) {
      discardSpare(sessionId, "idle");
    } else {
      next = Math.min(next, due);
    }
  }
  if (next !== Infinity) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      reconcile();
    }, next - now);
    idleTimer.unref?.();
  }
}

function onHostEvent(channel: string, payload: unknown): void {
  switch (channel) {
    case "session:deleted":
      if (typeof payload === "string") {
        discardSpare(payload, "session");
        lastViewedAt.delete(payload);
        failed.delete(payload);
      }
      reconcile();
      break;
    case "session:merged": {
      const id = (payload as { sessionId?: string } | null)?.sessionId;
      if (id) {
        discardSpare(id, "session");
      }
      break;
    }
    case "argus_config:changed": {
      const repoRoot = (payload as { repoRoot?: string } | null)?.repoRoot;
      for (const sessionId of warmSessions()) {
        if (appState.sessions.get(sessionId)?.repo_root === repoRoot) {
          discardSpare(sessionId, "config");
        }
      }
      reconcile();
      break;
    }
    case "claude-auth:accounts-changed":
      for (const sessionId of spareSessionIds()) {
        const spare = getSpare(sessionId);
        const session = appState.sessions.get(sessionId);
        if (
          spare &&
          spare.agent.accountId !== resolveAccountForSession(session)
        ) {
          discardSpare(sessionId, "account");
        }
      }
      reconcile();
      break;
    case "session:updated":
      reconcile();
      break;
  }
}

export function startWarmPolicy(
  overrides: Partial<PolicyOptions> & Pick<PolicyOptions, "spawn">,
): void {
  if (running) {
    return;
  }
  options = { ...options, ...overrides };
  running = true;
  teardown = [
    addHostEventSink((channel, args) => onHostEvent(channel, args[0])),
    onSpareEvent((event) => {
      // No retry until the view changes: a CLI that won't start keeps failing.
      if (
        event.type === "failed" ||
        (event.type === "discarded" && event.reason === "exited")
      ) {
        failed.add(event.sessionId);
      }
      if (event.type !== "ready") {
        // A taken or lost spare is replaced while its session is still viewed.
        queueMicrotask(reconcile);
      }
    }),
  ];
}

/** Stop warming and kill every spare — the host is going down. */
export function stopWarmPolicy(): void {
  running = false;
  for (const off of teardown) {
    off();
  }
  teardown = [];
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  viewers.clear();
  lastViewedAt.clear();
  failed.clear();
  clearSpares();
}
