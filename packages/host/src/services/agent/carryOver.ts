/** The one list of what an agent keeps when its CLI is replaced under the same id. */

import type { AgentSession } from "./models";

/** What feeds the replacement's spawn plan. */
export function carriedSettings(previous: AgentSession | null | undefined): {
  runnerId?: string;
  model?: string | null;
  permissionMode?: string | null;
} {
  return {
    runnerId: previous?.runner.id,
    model: previous?.model,
    permissionMode: previous?.permissionMode,
  };
}

export type CarriedState = Pick<
  AgentSession,
  | "contextWindow"
  | "costUsd"
  | "createdAt"
  | "lastToolName"
  | "lastToolUseAt"
  | "profile"
  | "suppressStatus"
  | "tokensTotal"
  | "toolUsesTotal"
  | "turnsCompleted"
>;

/** What the replacement's session starts with; fresh values without a previous one. */
export function carryOver(
  previous: AgentSession | null | undefined,
): CarriedState {
  return {
    turnsCompleted: previous?.turnsCompleted ?? 0,
    suppressStatus: previous?.suppressStatus ?? false,
    createdAt: previous?.createdAt ?? Date.now(),
    toolUsesTotal: previous?.toolUsesTotal ?? 0,
    costUsd: previous?.costUsd ?? 0,
    tokensTotal: previous?.tokensTotal ?? 0,
    lastToolUseAt: previous?.lastToolUseAt ?? null,
    lastToolName: previous?.lastToolName ?? null,
    contextWindow: previous?.contextWindow ?? null,
    profile: previous?.profile,
  };
}
