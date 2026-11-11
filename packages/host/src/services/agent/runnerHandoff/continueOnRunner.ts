/**
 * "Continue on…": start a new agent in the same session and worktree on
 * another runner, seeded with the chat so far. The old agent is left as it
 * was, minus any continue it had scheduled for after its usage limit.
 */

import type { LlmRunner } from "../../llm/runners/types";
import type { AgentInfo } from "../models";
import { appState } from "../../../state";
import { getRunnerById, runnerAvailability } from "../../llm/registry";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import { isAgentBusy } from "../accountSwitch";
import { launchAgent, telemetryRunner } from "../agentService";
import { submitAgentMessage } from "../conversation/actions";
import { conversationOf, reseedConversation } from "../conversation/folded";
import {
  dismissLimitResume,
  endLimitStall,
  isLimitStalled,
} from "../limitResume";
import { buildHandoffSeed } from "./seed";

export type ContinueSource = "limit_card" | "menu";

const CANONICAL_MODES = new Set(["ask", "auto", "plan", "review", "trusted"]);

/** Codex takes the seed as developer instructions, out of the user's turn. */
function takesNativeSeed(runner: LlmRunner): boolean {
  return (runner.baseRunnerId ?? runner.id) === "codex";
}

function kickoff(fromRunner: string): string {
  return `Continue where ${fromRunner} left off.`;
}

async function requireInstalled(runner: LlmRunner): Promise<void> {
  const availability = (await runnerAvailability()).get(runner.id);
  if (availability && !availability.available) {
    throw (
      availability.unavailableReason ?? `${runner.displayName} isn't installed`
    );
  }
}

export async function continueAgentOnRunner(
  agentId: string,
  runnerId: string,
  source: ContinueSource,
): Promise<AgentInfo> {
  const from = appState.agents.get(agentId);
  if (!from) {
    throw `No agent found: ${agentId}`;
  }
  const runner = getRunnerById(runnerId);
  if (!runner) {
    throw `Unknown runner: ${runnerId}`;
  }
  if (runner.id === from.runner.id) {
    throw `This chat is already on ${runner.displayName}.`;
  }
  // Two agents working the same task in one worktree would trip over each other.
  if (isAgentBusy(from)) {
    throw "The agent is still working. Stop it or wait for its turn to end.";
  }
  const conversation = conversationOf(agentId);
  if (!conversation.messages.some((m) => m.role === "user")) {
    throw "There's nothing to continue yet.";
  }
  await requireInstalled(runner);

  const fromRunner = from.runner.displayName;
  const native = takesNativeSeed(runner);
  const afterLimit = isLimitStalled(agentId);
  let seedKind: "inline" | "mcp" = "mcp";
  const capture = (success: boolean): void =>
    telemetryCapture("agent_continued_on_runner", {
      from_runner: telemetryRunner(from.runner),
      to_runner: telemetryRunner(runner),
      after_limit: afterLimit,
      source,
      seed: seedKind,
      native,
      success,
    });
  const seedFor = (mcp: boolean) =>
    buildHandoffSeed({ conversation, fromAgentId: agentId, fromRunner, mcp })
      .text;

  let info: AgentInfo;
  try {
    info = await launchAgent({
      sessionId: from.sessionId,
      permissionMode:
        from.permissionMode && CANONICAL_MODES.has(from.permissionMode)
          ? from.permissionMode
          : undefined,
      runnerId: runner.id,
      appendSystemPrompt: native ? seedFor(true) : undefined,
      fresh: true,
    });
  } catch (e) {
    capture(false);
    throw e;
  }

  // The chat lives on in the new agent; a continue here would race it.
  dismissLimitResume(agentId);
  endLimitStall(agentId);

  const handle = appState.agents.get(info.agent_id)?.handle;
  const mcp =
    runner.capabilities().supportsMcp && handle?.reachesHttpMcp?.() !== false;
  seedKind = mcp ? "mcp" : "inline";

  const fresh = conversationOf(info.agent_id);
  reseedConversation(info.agent_id, {
    ...fresh,
    title: conversation.title ?? fresh.title,
    todos: conversation.todos,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "system",
        textBlocks: [`Continued on ${runner.displayName} from ${fromRunner}`],
        toolCalls: [],
        timestamp: Date.now(),
        handoff: {
          fromAgentId: agentId,
          fromRunner,
          toRunner: runner.displayName,
        },
      },
    ],
  });

  try {
    await submitAgentMessage(info.agent_id, {
      text: native ? kickoff(fromRunner) : seedFor(mcp),
      displayText: kickoff(fromRunner),
    });
  } catch (e) {
    capture(false);
    throw e;
  }
  capture(true);

  return info;
}
