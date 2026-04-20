import type { AgentStatus } from "./types";
import {
  addAgent,
  getAgent,
  setActiveAgent,
  updateAgent,
} from "../stores/agentStore";
import { addUserMessage, queueMessage } from "../stores/conversationStore";
import { setActiveCenterView } from "../stores/editorStore";
import { selectWorkspace } from "../stores/workspaceStore";
import { notifyMessageSent, startAgentListening } from "./agentEventService";
import {
  type ImageAttachment,
  sendAgentMessage,
  startAgent as apiStartAgent,
} from "./ipc";

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

/**
 * Send a user-authored message to an agent, matching the behavior of the
 * chat input: optimistically adds the message to the transcript, marks the
 * agent as running, and either sends immediately or queues if the agent is
 * already processing a prior turn.
 *
 * Use this from every call site that programmatically messages an agent
 * (chat input, conflict-fix dispatch, command palette, etc.) so the
 * transcript and status stay consistent.
 *
 * Pass `assumeIdle: true` immediately after `startAgentInWorkspace` — the
 * freshly-spawned agent is marked "running" before any turn has begun, so
 * we want to send directly instead of queueing.
 */
export async function sendUserMessageToAgent(
  agentId: string,
  text: string,
  images?: ImageAttachment[],
  options: { assumeIdle?: boolean } = {},
): Promise<void> {
  const status = getAgent(agentId)?.status;

  if (!options.assumeIdle && status === "running") {
    queueMessage(agentId, text, images);

    return;
  }

  addUserMessage(agentId, text, images);
  notifyMessageSent(agentId);
  updateAgent(agentId, { status: "running" });
  await sendAgentMessage(agentId, text, images);
}
