/**
 * Triage a problem with Argus itself: a scratch pad holding the version, safe
 * settings and log snapshots, and a read-only agent that drafts an issue.
 */

import type { AgentInfo } from "../agent/models";
import type { Session } from "../session/models";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { sendAgentMessage, startAgent } from "../agent/agentService";
import { createScratchPad, disposeScratchPad } from "../scratchPad/manager";
import { capture } from "../telemetry/telemetry";
import {
  hostLogFiles,
  snapshotLogs,
  triageBrief,
  type TriageProblem,
} from "./context";
import { TRIAGE_PLAYBOOK, triageFirstMessage } from "./playbook";

/** Plan mode is the runner's read-only gate: it asks before any edit or command that writes. */
const READ_ONLY_MODE = "plan";

function padName(problem: TriageProblem): string {
  const first = problem.message?.trim().split("\n")[0] ?? "";
  if (!first) {
    return "Triage";
  }

  return `Triage: ${first.length > 60 ? `${first.slice(0, 59)}…` : first}`;
}

export async function startTriage(
  problem: TriageProblem,
): Promise<{ session: Session; agent: AgentInfo }> {
  const hasProblem = Boolean(problem.message?.trim());
  const session = createScratchPad({ name: padName(problem) });
  try {
    const files = hostLogFiles();
    const snapshots = snapshotLogs(session.path, files);
    fs.writeFileSync(
      path.join(session.path, "TRIAGE.md"),
      triageBrief(problem, { files, snapshots }),
    );
    const agent = await startAgent(
      session.id,
      undefined,
      READ_ONLY_MODE,
      undefined,
      TRIAGE_PLAYBOOK,
    );
    const message = triageFirstMessage(hasProblem);
    emitHostEvent("agent:started", { ...agent, initial_prompt: message });
    sendAgentMessage(agent.agent_id, message);
    // Clients only draw user bubbles for sends they made themselves.
    emitHostEvent(`agent:remote-message:${agent.agent_id}`, {
      message,
      author: null,
    });
    capture("triage_started", { has_problem: hasProblem, success: true });
    info(`Started triage agent ${agent.agent_id} in ${session.id}`);

    return { session, agent };
  } catch (e) {
    capture("triage_started", { has_problem: hasProblem, success: false });
    disposeScratchPad(session.id);
    appState.sessions.delete(session.id);
    emitHostEvent("session:deleted", session.id);
    throw `Couldn't start triage: ${String(e)}`;
  }
}
