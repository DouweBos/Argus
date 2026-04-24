import type { AgentStatus } from "./types";
import {
  addAgent,
  getAgent,
  removeAgent,
  setActiveAgent,
  updateAgent,
} from "../stores/agentStore";
import {
  addUserMessage,
  queueMessage,
  setCapabilities,
} from "../stores/conversationStore";
import { setActiveCenterView } from "../stores/editorStore";
import { pushError } from "../stores/notificationsStore";
import { selectSession } from "../stores/sessionStore";
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
 * Start a new agent in a session and wire up the frontend listeners/stores.
 * When `focus` is true (default), the agent is made active and the center
 * view switches to "agents". Use this from every call site that starts an
 * agent — shortcut handler, command palette, session hook.
 */
export async function startAgentInSession(
  sessionId: string,
  options: StartAgentOptions = {},
): Promise<AgentStatus> {
  const { focus = true, model, permissionMode, resumeSessionId } = options;

  // Optimistic path: mint the agent id on the renderer so the agent row,
  // active selection, and center-view switch can land in the store
  // synchronously. The backend's `start_agent` spawns a child process and
  // blocks on the CLI initialize handshake (can be 1–3s); without this the
  // "New Agent" button feels laggy.
  const agentId = crypto.randomUUID();
  const optimistic: AgentStatus = {
    agent_id: agentId,
    session_id: sessionId,
    status: "idle",
    permission_mode: permissionMode,
    created_at: Date.now(),
  };
  startAgentListening(agentId);
  addAgent(optimistic);
  if (focus) {
    focusAgent(sessionId, agentId);
  }

  try {
    const info = await apiStartAgent(
      sessionId,
      model,
      permissionMode,
      resumeSessionId,
      undefined,
      agentId,
    );
    // Reconcile backend-authoritative fields onto the optimistic entry.
    // The id is identical, so no replace — just patch any drift.
    updateAgent(agentId, {
      status: info.status,
      parent_agent_id: info.parent_agent_id,
      created_at: info.created_at,
    });
    // Capabilities are returned inline on start_agent because the backend's
    // `agent:capabilities` event fires before renderer listeners attach and
    // would otherwise be lost — seed the store directly.
    if (info.capabilities) {
      setCapabilities(agentId, info.capabilities);
    }

    return info;
  } catch (err) {
    removeAgent(agentId);
    pushError(err instanceof Error ? err.message : String(err), "start_agent");
    throw err;
  }
}

/**
 * Select the owning session, mark the given agent active, and surface the
 * agents view in the center panel.
 */
export function focusAgent(sessionId: string, agentId: string): void {
  selectSession(sessionId);
  setActiveAgent(sessionId, agentId);
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
 * Pass `assumeIdle: true` immediately after `startAgentInSession` — the
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
