import type { AgentSession } from "./models";
import type { LlmRunner } from "../llm/runners/types";
import type { Session } from "../session/models";
import { existsSync } from "node:fs";
import { appState } from "../../state";
import {
  DEFAULT_ACCOUNT_ID,
  getClaudeAccount,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { getRunnerById } from "../llm/registry";

/** Exactly what was paused; anything gone is refused rather than replaced. */
export function pausedSpawn(paused: AgentSession): {
  argusSession: Session & { path: string };
  runner: LlmRunner;
  accountId: string;
} {
  const argusSession = appState.sessions.get(paused.sessionId);
  // Not `liveSession`: an unplugged drive mustn't delete the session.
  if (!argusSession?.path || !existsSync(argusSession.path)) {
    throw "Its session's folder isn't available";
  }
  const runner = getRunnerById(paused.runner.id);
  if (!runner) {
    throw `${paused.runner.displayName} isn't set up on this computer any more`;
  }
  const accountId = paused.accountId ?? resolveAccountForSession(argusSession);
  if (accountId !== DEFAULT_ACCOUNT_ID && !getClaudeAccount(accountId)) {
    throw "The account it ran on was removed. Pick another account for this chat";
  }

  return {
    argusSession: argusSession as Session & { path: string },
    runner,
    accountId,
  };
}
