/**
 * Watched pull requests: each session's PR is polled every two minutes, and
 * a check failing, the gating checks passing, a merge conflict or a new
 * comment wakes the session's agent through the message queue. Watching ends
 * when the PR merges or closes, or the session goes.
 *
 * In memory only, like the message queue: the agents a watch wakes don't
 * outlive the host either.
 */

import type { PrSnapshot, WatchEvent, WatchMemory } from "./snapshot";
import type { Session } from "../../session/models";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "../../../platform";
import { appState } from "../../../state";
import { submitAgentMessage } from "../../agent/conversation/actions";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import {
  sessionPullRequest,
  sessionPullRequestMayHaveChanged,
} from "../sessionPullRequests";
import { failedLogExcerpt, fetchPrSnapshot } from "./fetch";
import {
  checksGreen,
  diffSnapshot,
  emptyMemory,
  wakeMessage,
  wakeSummary,
} from "./snapshot";
import {
  clearWatchedPullRequests,
  markPullRequestWatched,
  POLL_MS,
} from "./watched";

const execFileAsync = promisify(execFile);

/** Consecutive failed polls before the log hears about it. */
const QUIET_FAILURES = 3;

export type WatchVia = "mcp" | "ui";

interface Watch {
  /** The agent that asked, or the one the UI picked; woken first. */
  agentId: string | null;
  failures: number;
  memory: WatchMemory;
  number: number;
  owner: string;
  polling: boolean;
  repo: string;
  sessionId: string;
  url: string;
  wakes: number;
}

export interface PrWatchStatus {
  agent_id: string | null;
  checks: { failing: string[]; passing: number; pending: number };
  green: boolean;
  mergeable: PrSnapshot["mergeable"];
  pr_number: number;
  pr_url: string;
}

const watches = new Map<string, Watch>();
let ticker: ReturnType<typeof setInterval> | null = null;
let removeSink: (() => void) | null = null;

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

/** The session's open PR, from the cache or straight from `gh` for a fresh one. */
async function resolvePullRequest(
  session: Session,
): Promise<{ number: number; owner: string; repo: string; url: string }> {
  const cached = sessionPullRequest(session.id);
  let url =
    cached && (cached.state === "open" || cached.state === "draft")
      ? cached.url
      : null;
  if (!url) {
    let view: { state?: string; url?: string };
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", "--json", "url,state"],
        { cwd: session.path },
      );
      view = JSON.parse(stdout) as typeof view;
    } catch {
      throw `No pull request found for branch ${session.branch}. Open one first.`;
    }
    if (view.state !== "OPEN" || !view.url) {
      throw `The pull request for ${session.branch} is ${view.state?.toLowerCase() ?? "not open"}.`;
    }
    url = view.url;
    // Argus hasn't seen this PR yet; let the session row pick it up too.
    sessionPullRequestMayHaveChanged(session.id);
  }
  const match = PR_URL.exec(url);
  if (!match) {
    throw `Not a GitHub pull request: ${url}`;
  }

  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
    url,
  };
}

function isLive(agentId: string | null): agentId is string {
  const agent = agentId ? appState.agents.get(agentId) : undefined;

  return !!agent && agent.status !== "stopped" && agent.status !== "error";
}

/** The session's agent to talk to: newest live top-level one first. */
function sessionAgent(sessionId: string): string | null {
  const live = [...appState.agents.values()]
    .filter((a) => a.sessionId === sessionId && isLive(a.agentId))
    .sort(
      (a, b) =>
        Number(a.parentAgentId !== null) - Number(b.parentAgentId !== null) ||
        b.createdAt - a.createdAt,
    );

  return live[0]?.agentId ?? null;
}

function publish(sessionId: string): void {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    return;
  }
  emitHostEvent("session:updated", {
    id: sessionId,
    repo_root: session.repo_root,
    pull_request_watched: watches.has(sessionId),
  });
}

function toStatus(watch: Watch, snap: PrSnapshot): PrWatchStatus {
  return {
    pr_number: snap.number,
    pr_url: snap.url,
    agent_id: watch.agentId,
    mergeable: snap.mergeable,
    green: checksGreen(snap.checks),
    checks: {
      failing: snap.checks
        .filter((c) => c.bucket === "fail")
        .map((c) => c.name),
      passing: snap.checks.filter((c) => c.bucket === "pass").length,
      pending: snap.checks.filter((c) => c.bucket === "pending").length,
    },
  };
}

type EndReason = "closed" | "merged" | "session_deleted" | "stopped";

function wakeBucket(n: number): "0" | "1" | "2-5" | "6+" {
  if (n === 0) {
    return "0";
  }
  if (n === 1) {
    return "1";
  }

  return n <= 5 ? "2-5" : "6+";
}

function end(sessionId: string, reason: EndReason): void {
  const watch = watches.get(sessionId);
  if (!watch) {
    return;
  }
  watches.delete(sessionId);
  markPullRequestWatched(sessionId, false);
  telemetryCapture("pr_watch_ended", {
    reason,
    wakes_bucket: wakeBucket(watch.wakes),
  });
  if (reason !== "session_deleted") {
    publish(sessionId);
  }
  if (watches.size === 0) {
    stopTicker();
  }
}

async function wake(
  watch: Watch,
  snap: PrSnapshot,
  events: WatchEvent[],
): Promise<void> {
  const logs = new Map<string, string>();
  for (const e of events) {
    if (e.kind === "check_failed") {
      const excerpt = await failedLogExcerpt(e.check.detailsUrl);
      if (excerpt) {
        logs.set(e.check.name, excerpt);
      }
    }
  }
  const summary = wakeSummary(snap.number, events);
  const agentId = isLive(watch.agentId)
    ? watch.agentId
    : sessionAgent(watch.sessionId);
  let outcome: "no_agent" | "queued" | "sent" = "no_agent";
  if (agentId) {
    watch.agentId = agentId;
    const { queued } = await submitAgentMessage(agentId, {
      text: wakeMessage(snap, events, logs),
      displayText: summary,
    });
    outcome = queued ? "queued" : "sent";
    watch.wakes += 1;
  } else {
    // Nobody to hand it to; the engineer is the next best reader.
    hostPlatform().notify({
      title: summary,
      body: "No agent is running in this session to pick it up.",
    });
  }
  telemetryCapture("pr_watch_woke", {
    check_failed: events.some((e) => e.kind === "check_failed"),
    checks_passed: events.some((e) => e.kind === "checks_passed"),
    comment: events.some((e) => e.kind === "comment"),
    conflict: events.some((e) => e.kind === "conflict"),
    outcome,
  });
}

/** End on merge/close, wake on anything new. */
async function apply(watch: Watch, snap: PrSnapshot): Promise<void> {
  if (watches.get(watch.sessionId) !== watch) {
    return;
  }
  if (snap.state !== "OPEN") {
    end(watch.sessionId, snap.state === "MERGED" ? "merged" : "closed");
    sessionPullRequestMayHaveChanged(watch.sessionId);

    return;
  }
  const events = diffSnapshot(watch.memory, snap);
  if (events.length > 0) {
    await wake(watch, snap, events);
  }
}

async function poll(watch: Watch): Promise<void> {
  if (watch.polling) {
    return;
  }
  watch.polling = true;
  try {
    const snap = await fetchPrSnapshot(watch.owner, watch.repo, watch.number);
    watch.failures = 0;
    await apply(watch, snap);
  } catch (e) {
    watch.failures += 1;
    if (watch.failures === QUIET_FAILURES) {
      warn(`PR watch on #${watch.number} keeps failing:`, e);
    }
  } finally {
    watch.polling = false;
  }
}

function pollAll(): void {
  for (const watch of watches.values()) {
    poll(watch).catch(() => undefined);
  }
}

function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function ensureTicker(): void {
  if (!ticker) {
    ticker = setInterval(pollAll, POLL_MS);
    ticker.unref?.();
  }
}

/**
 * Start watching the session's open PR — or re-aim an existing watch at
 * another agent — and return where it stands now.
 */
export async function watchPullRequest(
  sessionId: string,
  { agentId, via }: { agentId?: string | null; via: WatchVia },
): Promise<PrWatchStatus> {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `No session found: ${sessionId}`;
  }
  const target = isLive(agentId ?? null) ? agentId! : sessionAgent(sessionId);
  const existing = watches.get(sessionId);
  if (existing) {
    existing.agentId = target ?? existing.agentId;
    const snap = await fetchPrSnapshot(
      existing.owner,
      existing.repo,
      existing.number,
    );

    return toStatus(existing, snap);
  }
  let pr: Awaited<ReturnType<typeof resolvePullRequest>>;
  let snap: PrSnapshot;
  try {
    pr = await resolvePullRequest(session);
    snap = await fetchPrSnapshot(pr.owner, pr.repo, pr.number);
  } catch (e) {
    telemetryCapture("pr_watch_toggled", {
      action: "start",
      via,
      success: false,
    });
    throw typeof e === "string"
      ? e
      : `Could not read the pull request: ${String(e)}`;
  }
  // A second toggle raced this one in.
  const raced = watches.get(sessionId);
  if (raced) {
    return toStatus(raced, snap);
  }
  const watch: Watch = {
    ...pr,
    sessionId,
    agentId: target,
    failures: 0,
    memory: emptyMemory(),
    polling: false,
    wakes: 0,
  };
  watches.set(sessionId, watch);
  markPullRequestWatched(sessionId, true);
  ensureTicker();
  telemetryCapture("pr_watch_toggled", { action: "start", via, success: true });
  publish(sessionId);
  // Failures already showing wake the agent right after this returns.
  apply(watch, snap).catch((e) => warn("PR watch wake failed:", e));

  return toStatus(watch, snap);
}

export function unwatchPullRequest(sessionId: string, via: WatchVia): boolean {
  if (!watches.has(sessionId)) {
    return false;
  }
  telemetryCapture("pr_watch_toggled", { action: "stop", via, success: true });
  end(sessionId, "stopped");

  return true;
}

function onHostEvent(channel: string, args: unknown[]): void {
  if (channel === "session:deleted" && typeof args[0] === "string") {
    end(args[0], "session_deleted");
  }
}

export function startPrWatches(): void {
  removeSink ??= addHostEventSink(onHostEvent);
}

export function stopPrWatches(): void {
  stopTicker();
  removeSink?.();
  removeSink = null;
  watches.clear();
  clearWatchedPullRequests();
}
