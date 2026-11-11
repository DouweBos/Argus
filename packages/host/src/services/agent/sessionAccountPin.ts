/**
 * Pinning a session's Claude account, apart from moving a live agent onto it,
 * so callers that only pin before a spawn don't import the agent service.
 */

import { appState } from "../../state";
import { setSessionClaudeAccount } from "../session/sessionOps";
import { discardSpare } from "./spares";

/** Pin the session to `accountId`; returns the pin it replaced. */
export function pinSessionAccount(
  sessionId: string,
  accountId: string | null,
): string | null {
  const previous = appState.sessions.get(sessionId)?.claude_account_id ?? null;
  setSessionClaudeAccount(sessionId, accountId);
  // The spare was spawned on the old account.
  discardSpare(sessionId, "account");

  return previous;
}
