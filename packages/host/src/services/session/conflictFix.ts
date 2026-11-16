import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { capture } from "../telemetry/telemetry";
import { getSessionConflicts } from "./sessionOps";

/** What the agent is asked to do; the merge itself stays the user's call. */
export function conflictFixPrompt(
  branch: string,
  base: string,
  files: string[],
): string {
  const list = files.map((f) => `- \`${f}\``).join("\n");

  return [
    `\`${branch}\` can't merge into \`${base}\`: these files conflict.`,
    "",
    list,
    "",
    `Commit any uncommitted work, then rebase this branch onto \`${base}\` (\`git rebase ${base}\`) and resolve every conflict, keeping what both sides meant. After each step, \`git add\` the resolved files and \`git rebase --continue\` until the rebase finishes.`,
    "",
    `Then build and run the tests that cover what changed. Don't merge into \`${base}\` and don't push: I'll merge once you're done.`,
  ].join("\n");
}

function fileBucket(count: number): "1" | "2-5" | "6+" {
  if (count <= 1) {
    return "1";
  }

  return count <= 5 ? "2-5" : "6+";
}

/**
 * Start an agent in the session that rebases it onto its base and resolves
 * the conflicts a merge would hit. Refuses when nothing conflicts.
 */
export async function startConflictFix(
  sessionId: string,
): Promise<{ agent_id: string; files: string[] }> {
  const ws = appState.sessions.get(sessionId);
  if (!ws?.branch || !ws.base_branch || !ws.path) {
    throw "This session has no branch to rebase.";
  }
  const files = await getSessionConflicts(sessionId);
  if (files.length === 0) {
    throw `Nothing conflicts with ${ws.base_branch}; merge it instead.`;
  }
  // Lazy: agentService reaches back to the gateway through notifications.
  const { sendAgentMessage, startAgent } =
    await import("../agent/agentService");
  try {
    const agent = await startAgent(sessionId);
    const prompt = conflictFixPrompt(ws.branch, ws.base_branch, files);
    // Backend-initiated spawns are invisible to clients without this.
    emitHostEvent("agent:started", {
      agent_id: agent.agent_id,
      session_id: agent.session_id,
      status: agent.status,
      parent_agent_id: agent.parent_agent_id,
      created_at: agent.created_at,
      initial_prompt: prompt,
      model: agent.model,
    });
    sendAgentMessage(agent.agent_id, prompt);
    // Clients only draw user bubbles for sends they made themselves.
    emitHostEvent(`agent:remote-message:${agent.agent_id}`, {
      message: prompt,
      author: null,
    });
    capture("conflict_fix_started", {
      file_bucket: fileBucket(files.length),
      success: true,
    });
    info(`Started conflict fix ${agent.agent_id} in ${sessionId}`);

    return { agent_id: agent.agent_id, files };
  } catch (e) {
    capture("conflict_fix_started", {
      file_bucket: fileBucket(files.length),
      success: false,
    });
    throw e;
  }
}
