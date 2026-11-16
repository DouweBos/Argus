/**
 * Move a chat to another session, in this project or another: a new agent
 * there picks the conversation up and the old one stops. Its edits stay in the
 * old worktree, since another repo's paths rarely line up.
 */

import type { AgentInfo } from "../models";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { appState } from "../../../state";
import { createSession } from "../../session/manager";
import { setSessionClaudeAccount } from "../../session/sessionOps";
import { waitForSessionReady } from "../../session/waitForReady";
import { capture } from "../../telemetry/telemetry";
import {
  launchAgent,
  setAgentEffort,
  stopAgent,
  telemetryRunner,
} from "../agentService";
import { isAgentBusy } from "../busy";
import { dismissLimitResume, endLimitStall } from "../limitResume";
import {
  agentForkPoint,
  forkSeed,
  isClaudeRunner,
  seedForkedConversation,
} from "./actions";
import { conversationOf } from "./folded";
import { nativeFork } from "./forkAt";

/** Exactly one: an existing session, or a project to open a new one in. */
export type TransferTarget = { repoRoot: string } | { sessionId: string };

function where(sessionId: string): string {
  const s = appState.sessions.get(sessionId);
  if (!s) {
    return "another session";
  }

  return `${s.path} (project ${path.basename(s.repo_root)}, branch ${s.branch})`;
}

/** What the agent hears first: where it is now, and what didn't come along. */
export function moveNote(fromSessionId: string, toSessionId: string): string {
  return (
    "<chat-moved>\n" +
    `This chat moved from ${where(fromSessionId)} to ${where(toSessionId)}. ` +
    "Work here from now on: paths, branches and commands earlier in the chat refer to the old location, " +
    "and changes made there were not carried over. Check this worktree before relying on them.\n" +
    "</chat-moved>"
  );
}

function existingTarget(sessionId: string, sourceSessionId: string): string {
  const dest = appState.sessions.get(sessionId);
  if (!dest) {
    throw `Session not found: ${sessionId}`;
  }
  if (dest.id === sourceSessionId) {
    throw "The chat is already in this session";
  }
  if (dest.kind !== "worktree" && dest.kind !== "project_root") {
    throw "A chat can only move to a project's session";
  }

  return dest.id;
}

/**
 * Starts the chat in `sessionId` once it's ready, then stops the source. A
 * failure leaves the source running, so nothing is lost.
 */
async function moveInto(
  agentId: string,
  sessionId: string,
  report: (history: "native" | "seeded" | undefined) => void,
): Promise<AgentInfo> {
  try {
    await waitForSessionReady(sessionId);
    const source = appState.agents.get(agentId);
    if (!source || isAgentBusy(source)) {
      throw "The agent started working again before the move finished";
    }
    const fromSessionId = source.sessionId;
    const claude = isClaudeRunner(source.runner);
    const last = conversationOf(agentId).messages.at(-1)!;
    const point = agentForkPoint(agentId, last.id);
    const resume = await nativeFork(
      source.runner,
      point,
      fromSessionId,
      sessionId,
    );
    const agent = await launchAgent({
      sessionId,
      model: source.model ?? undefined,
      permissionMode: source.permissionMode ?? undefined,
      runnerId: source.runner.id,
      resumeSessionId: resume ?? undefined,
      fresh: true,
    });
    const started = appState.agents.get(agent.agent_id);
    if (started) {
      started.pendingSeed = resume ? undefined : forkSeed(agentId, last.id);
      started.pendingNote = moveNote(fromSessionId, sessionId);
    }
    if (source.effort) {
      await setAgentEffort(agent.agent_id, source.effort).catch((e: unknown) =>
        warn(`[agent:${agent.agent_id}] move kept no effort: ${String(e)}`),
      );
    }
    seedForkedConversation(
      agent.agent_id,
      { agentId, throughMessageId: last.id },
      resume ?? undefined,
      claude && resume != null,
    );

    // The chat lives on in the new agent; a continue here would race it.
    dismissLimitResume(agentId);
    endLimitStall(agentId);
    await stopAgent(agentId).catch((e: unknown) =>
      warn(`[agent:${agentId}] left running after its move: ${String(e)}`),
    );
    report(resume ? "native" : "seeded");

    return agent;
  } catch (e) {
    report(undefined);
    throw e;
  }
}

/**
 * Into an existing session the new agent comes back with the result; into a
 * new one the session does, and its agent starts once setup has finished.
 */
export async function transferAgent(
  agentId: string,
  target: TransferTarget,
): Promise<{ sessionId: string; agent: AgentInfo | null }> {
  const source = appState.agents.get(agentId);
  if (!source) {
    throw `No agent found: ${agentId}`;
  }
  if (isAgentBusy(source)) {
    throw "The agent is still working. Stop it or wait for its turn to end.";
  }
  const conversation = conversationOf(agentId);
  if (!conversation.messages.some((m) => m.role === "user")) {
    throw "There's nothing to move yet.";
  }
  const fromSessionId = source.sessionId;
  const fromRepo = appState.sessions.get(fromSessionId)?.repo_root;
  const toRepo =
    "repoRoot" in target
      ? target.repoRoot
      : appState.sessions.get(target.sessionId)?.repo_root;
  const report = (history: "native" | "seeded" | undefined) =>
    capture("agent_transferred", {
      runner: telemetryRunner(source.runner),
      target: "sessionId" in target ? "existing_session" : "new_session",
      cross_project: toRepo !== fromRepo,
      ...(history ? { history } : {}),
      success: history !== undefined,
    });

  if ("sessionId" in target) {
    const sessionId = existingTarget(target.sessionId, fromSessionId);

    return { sessionId, agent: await moveInto(agentId, sessionId, report) };
  }
  let session;
  try {
    session = await createSession(
      target.repoRoot,
      "",
      conversation.title?.trim() || "Moved chat",
      false,
      undefined,
      undefined,
      { awaitWorktreeReady: true },
    );
  } catch (e) {
    report(undefined);
    throw e;
  }
  // The chat keeps the account it was on, so its limits and MCPs come along.
  if (isClaudeRunner(source.runner) && source.accountId) {
    setSessionClaudeAccount(session.id, source.accountId);
  }
  moveInto(agentId, session.id, report).catch((e: unknown) =>
    warn(`[agent:${agentId}] move to ${session.id} failed: ${String(e)}`),
  );

  return { sessionId: session.id, agent: null };
}
