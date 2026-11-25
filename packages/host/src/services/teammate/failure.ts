/**
 * Why a conversation's turn stopped, in a few words a person can act on.
 * Pure, so the thread store and the Slack bridge word it the same way.
 */

import { classifyRunFailure } from "../claudeAuth/accounts";

export type ThreadFailureKind =
  | "auth"
  | "crashed"
  | "error"
  | "interrupted"
  | "limit";

export interface TeammateThreadFailure {
  kind: ThreadFailureKind;
  /** One short sentence for the thread and Slack. */
  reason: string;
  at: number;
  /** When a spent usage limit resets, epoch ms, when the runner said. */
  resets_at: number | null;
}

const MAX_REASON = 200;

/** A turn whose `result` came back as an error. */
export function resultFailure(
  text: string,
  resetsAt: number | null,
  now: number,
): TeammateThreadFailure {
  const outcome = classifyRunFailure(text);
  if (outcome === "rate_limited") {
    return {
      kind: "limit",
      reason: "Hit the usage limit.",
      at: now,
      resets_at: resetsAt,
    };
  }
  if (outcome === "reauth") {
    return {
      kind: "auth",
      reason: "The account needs signing in again.",
      at: now,
      resets_at: null,
    };
  }
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  let reason = line || "The turn ended with an error.";
  if (reason.length > MAX_REASON) {
    reason = `${reason.slice(0, MAX_REASON - 1)}…`;
  }

  return {
    kind: "error",
    reason,
    at: now,
    resets_at: null,
  };
}

/** The agent's process went away in the middle of a turn. */
export function crashFailure(
  code: number | null,
  now: number,
): TeammateThreadFailure {
  return {
    kind: "crashed",
    reason:
      code === null
        ? "The agent quit unexpectedly."
        : `The agent quit unexpectedly (exit code ${code}).`,
    at: now,
    resets_at: null,
  };
}

/** The host went down mid-turn too often to keep picking it back up. */
export function interruptedFailure(now: number): TeammateThreadFailure {
  return {
    kind: "interrupted",
    reason: "Interrupted by a restart.",
    at: now,
    resets_at: null,
  };
}
