/**
 * What a session's agents are up to, as one state, a tone and a line of text.
 * Port of ArgusCore's `SessionActivity` and `SessionFacts.title`, so the web
 * sidebar reads a session the way the Mac's does.
 */

import type { RemoteAgentStatus, RemoteSession } from "@argus/remote-protocol";

export type SessionActivityState =
  | "failed"
  | "idle"
  | "preparing"
  | "unavailable"
  | "waiting"
  | "working";

/** The dot's colour, in Peacock's `StatusTone` terms. */
export type SessionActivityTone = "accent" | "error" | "idle" | "warning";

type Agent = Pick<
  RemoteAgentStatus,
  "awaiting" | "created_at" | "last_activity_at" | "status"
>;
type Session = Pick<
  RemoteSession,
  "availability" | "branch" | "display_name" | "setup_error" | "status"
>;

export interface SessionActivity {
  state: SessionActivityState;
  tone: SessionActivityTone;
  /** Worth a dot: working, waiting on you, broken, or setting up. */
  showsDot: boolean;
  busy: boolean;
  /** "Setting up…", the error, or how many agents there are. */
  statusText: string | null;
  /** When one of its agents last did something, in epoch milliseconds. */
  lastActive: number | null;
}

/** The session's name: its display name, else its branch. */
export function sessionTitle(session: Session): string {
  return session.display_name?.trim() || session.branch;
}

/** The branch, only when the title doesn't already say it. */
export function sessionSubtitle(session: Session): string | null {
  const title = sessionTitle(session);

  return title === session.branch || !session.branch ? null : session.branch;
}

function stateOf(session: Session, agents: Agent[], busy: boolean) {
  if (session.availability === "unavailable") {
    return "unavailable";
  }
  switch (session.status) {
    case "error":
      return "failed";
    case "initializing":
    case "deleting":
      return "preparing";
    case "ready":
      if (agents.some((a) => a.awaiting)) {
        return "waiting";
      }

      return busy ? "working" : "idle";
  }
}

const TONES: Record<SessionActivityState, SessionActivityTone> = {
  failed: "error",
  waiting: "warning",
  working: "accent",
  unavailable: "idle",
  preparing: "idle",
  idle: "idle",
};

export function sessionActivity(
  session: Session,
  agents: Agent[],
): SessionActivity {
  const busy =
    session.status === "initializing" ||
    agents.some((a) => a.status === "running");
  const state = stateOf(session, agents, busy);
  const showsDot =
    state === "failed" ||
    state === "waiting" ||
    state === "working" ||
    (state === "preparing" && session.status === "initializing");
  let statusText: string | null = null;
  if (session.status === "error") {
    statusText = session.setup_error ?? "Setup failed";
  } else if (session.status === "initializing") {
    statusText = "Setting up…";
  } else if (session.status === "deleting") {
    statusText = "Deleting…";
  } else if (agents.length > 0) {
    statusText = `${agents.length} agent${agents.length === 1 ? "" : "s"}`;
  }
  const times = agents
    .map((a) => a.last_activity_at ?? a.created_at)
    .filter((t): t is number => typeof t === "number");

  return {
    state,
    tone: TONES[state],
    showsDot,
    busy,
    statusText,
    lastActive: times.length > 0 ? Math.max(...times) : null,
  };
}

/** "now", "5m", "4h", "3d", "2w": how long ago, as tight as a list row needs. */
export function shortAge(timestamp: number, now = Date.now()): string {
  const ms = timestamp > 100_000_000_000 ? timestamp : timestamp * 1000;
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);

  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}
