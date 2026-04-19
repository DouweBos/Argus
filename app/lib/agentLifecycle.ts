import type { AgentStatus } from "./types";
import { addAgent, setActiveAgent } from "../stores/agentStore";
import { setActiveCenterView } from "../stores/editorStore";
import { selectWorkspace } from "../stores/workspaceStore";
import { startAgentListening } from "./agentEventService";
import { startAgent as apiStartAgent } from "./ipc";

interface StartAgentOptions {
  focus?: boolean;
  model?: string;
  permissionMode?: string;
  resumeSessionId?: string;
}

/**
 * Start a new agent in a workspace and wire up the frontend listeners/stores.
 * When `focus` is true (default), the agent is made active and the center
 * view switches to "agents". Use this from every call site that starts an
 * agent — shortcut handler, command palette, workspace hook.
 */
export async function startAgentInWorkspace(
  workspaceId: string,
  options: StartAgentOptions = {},
): Promise<AgentStatus> {
  const { focus = true, model, permissionMode, resumeSessionId } = options;

  const info = await apiStartAgent(
    workspaceId,
    model,
    permissionMode,
    resumeSessionId,
  );
  startAgentListening(info.agent_id);
  addAgent({
    agent_id: info.agent_id,
    workspace_id: info.workspace_id,
    status: "running",
    permission_mode: permissionMode,
  });

  if (focus) {
    focusAgent(info.workspace_id, info.agent_id);
  }

  return info;
}

/**
 * Select the owning workspace, mark the given agent active, and surface the
 * agents view in the center panel.
 */
export function focusAgent(workspaceId: string, agentId: string): void {
  selectWorkspace(workspaceId);
  setActiveAgent(workspaceId, agentId);
  setActiveCenterView("agents");
}
