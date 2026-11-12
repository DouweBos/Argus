/**
 * What the phone's Live Activity shows: the agents worth a glance, worst news
 * first. Pure, so the dispatcher and the gateway's first snapshot agree.
 */

export type ActivityPhase = "done" | "failed" | "needsYou" | "working";

/** A permission prompt the Lock Screen can answer with Approve/Deny. */
export interface ActivityPrompt {
  summary: string;
  toolUseId: string;
}

export interface ActivityAgent {
  /** Set once it stopped working; finished agents linger for a glance. */
  endedAt: number | null;
  id: string;
  /** Lets a tap open the agent's chat. */
  sessionId: string;
  /** Ms. The phone counts elapsed time from it on its own clock. */
  startedAt: number;
  project: string | null;
  prompt: ActivityPrompt | null;
  state: ActivityPhase;
  /** The tool it is on, in a few words. */
  step: string | null;
  title: string;
}

/** The sealed half of the content-state. */
export interface ActivitySnapshot {
  agents: ActivityAgent[];
  /** Agents past the cut, so the island can say "+2". */
  more: number;
}

/** How many agents fit a Lock Screen card, and a payload under APNs' 4 KB. */
export const ACTIVITY_AGENT_LIMIT = 3;
/** How long a finished agent stays on the activity. */
export const OUTCOME_LINGER_MS = 15 * 60 * 1000;

const RANK: Record<ActivityPhase, number> = {
  needsYou: 0,
  working: 1,
  failed: 2,
  done: 3,
};

function clip(value: string | null, max: number): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Shortens every free-text field so three agents seal well under 4 KB. */
export function clipAgent(agent: ActivityAgent): ActivityAgent {
  return {
    ...agent,
    title: clip(agent.title, 60) ?? "Agent",
    project: clip(agent.project, 40),
    step: clip(agent.step, 60),
    prompt: agent.prompt
      ? { ...agent.prompt, summary: clip(agent.prompt.summary, 80) ?? "" }
      : null,
  };
}

/** Waiting ones first, then running, then the most recently finished. */
export function snapshotOf(
  agents: ActivityAgent[],
  now: number,
  limit = ACTIVITY_AGENT_LIMIT,
): ActivitySnapshot {
  const shown = agents
    .filter((a) => a.endedAt === null || now - a.endedAt < OUTCOME_LINGER_MS)
    .sort((a, b) => {
      if (RANK[a.state] !== RANK[b.state]) {
        return RANK[a.state] - RANK[b.state];
      }
      const at = (x: ActivityAgent): number => x.endedAt ?? x.startedAt;

      return at(b) - at(a);
    });

  return {
    agents: shown.slice(0, limit).map(clipAgent),
    more: Math.max(0, shown.length - limit),
  };
}

/** The coarse phase the relay may see: the most urgent agent's. */
export function phaseOf(snapshot: ActivitySnapshot): ActivityPhase {
  return snapshot.agents[0]?.state ?? "done";
}

/** Nothing left running or waiting: the activity can end. */
export function isSettled(snapshot: ActivitySnapshot): boolean {
  return snapshot.agents.every(
    (a) => a.state === "done" || a.state === "failed",
  );
}

/** A tool call in a few words: its name, and the file or command it names. */
export function stepSummary(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  for (const key of ["file_path", "path", "notebook_path"]) {
    const value = input?.[key];
    if (typeof value === "string" && value) {
      return `${name} ${value.split("/").pop() ?? value}`;
    }
  }
  for (const key of ["command", "pattern", "url", "query", "description"]) {
    const value = input?.[key];
    if (typeof value === "string" && value) {
      return `${name} ${value}`;
    }
  }

  return name;
}
