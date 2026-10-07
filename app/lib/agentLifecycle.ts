import type { AgentStatus } from "./types";
import {
  addAgent,
  removeAgent,
  setActiveAgent,
  updateAgent,
} from "../stores/agentStore";
import { setActiveCenterView } from "../stores/editorStore";
import { pushError } from "../stores/notificationsStore";
import { clearPrewarm, getPrewarmSlot } from "../stores/prewarmStore";
import { selectSession } from "../stores/sessionStore";
import { getDefaultPermissionMode } from "../stores/settingsStore";
import { notifyMessageSent, startAgentListening } from "./agentEventService";
import { huddleAuthor } from "./huddleAuthor";
import {
  claimPrewarmAgent,
  type ImageAttachment,
  setAgentRunner,
  startAgent as apiStartAgent,
  submitAgentMessage,
} from "./ipc";
import { refetch } from "./transcriptSync";

interface StartAgentOptions {
  focus?: boolean;
  model?: string;
  permissionMode?: string;
  resumeSessionId?: string;
  /** Runner to spawn under. Defaults to the session's. */
  runnerId?: string;
  /** A fork: the host seeds the transcript from this agent's, up to the message. */
  seedFrom?: { agentId: string; throughMessageId: string };
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
  const { focus = true, model, resumeSessionId, runnerId, seedFrom } = options;
  // Resolve the permission mode for every spawn — the app-level default
  // applies unless the caller passed an explicit one, so an agent never
  // silently falls back to the CLI's prompt-for-everything default.
  const permissionMode = options.permissionMode ?? getDefaultPermissionMode();

  // Prefer claiming a prewarmed slot — the Claude subprocess is already
  // alive and past initialize, so the user-facing path is sub-second.
  // `resumeSessionId` and `seedFrom` are incompatible with prewarms (the warm
  // slot was started fresh, not resumed) so fall back to a normal spawn then.
  if (!resumeSessionId && !seedFrom) {
    const slot = getPrewarmSlot(sessionId);
    if (slot && slot.status === "ready" && slot.agentId) {
      try {
        // The warm subprocess was spawned under the session's runner; a
        // no-op when the dialog already re-bound it on pick.
        if (runnerId) {
          await setAgentRunner(slot.agentId, runnerId);
        }
        const claimed = await claimPrewarm(slot.agentId, sessionId, {
          focus,
          model,
          permissionMode,
        });

        return claimed;
      } catch (err) {
        // Fall through to a normal spawn — the warm slot may have died, or
        // the model/permission change was rejected. Better to take the slow
        // path than fail the user's action.
        // eslint-disable-next-line no-console
        console.warn(
          "[prewarm] claim failed, falling back to fresh spawn:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

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
      runnerId,
      seedFrom,
    );
    // Reconcile backend-authoritative fields onto the optimistic entry.
    // The id is identical, so no replace — just patch any drift.
    updateAgent(agentId, {
      status: info.status,
      parent_agent_id: info.parent_agent_id,
      created_at: info.created_at,
      model: info.model,
      runner_id: info.runner_id,
    });
    // Capabilities are returned inline on start_agent because the backend's
    // `agent:capabilities` event fires before renderer listeners attach and
    // would otherwise be lost — seed the store directly.
    // The host started folding it just now; a page fetched before that was empty.
    refetch(agentId).catch(() => {});

    return info;
  } catch (err) {
    removeAgent(agentId);
    pushError(err instanceof Error ? err.message : String(err), "start_agent");
    throw err;
  }
}

/**
 * Claim a prewarmed Claude subprocess as a real agent. Applies any model /
 * permission-mode change requested by the caller (via the existing control
 * protocol — no respawn) and registers the agent with the renderer stores
 * the same way `startAgentInSession` would. The prewarm slot is cleared on
 * success so the prewarm service can spin up a fresh one.
 */
async function claimPrewarm(
  agentId: string,
  sessionId: string,
  opts: { focus: boolean; model?: string; permissionMode?: string },
): Promise<AgentStatus> {
  startAgentListening(agentId);
  // Drop the prewarm slot *before* registering the agent. `addAgent` fires
  // the agentStore subscriber synchronously, which re-runs the prewarm
  // reconcile loop; if the slot is still there it sees `shouldPrewarm=false`
  // (a real agent now exists for this session) and discards the very slot
  // we're mid-claim of, SIGTERM'ing the backing Claude process.
  clearPrewarm(sessionId);
  const optimistic: AgentStatus = {
    agent_id: agentId,
    session_id: sessionId,
    status: "idle",
    permission_mode: opts.permissionMode,
    created_at: Date.now(),
  };
  addAgent(optimistic);
  if (opts.focus) {
    focusAgent(sessionId, agentId);
  }

  try {
    const info = await claimPrewarmAgent(agentId, {
      model: opts.model,
      permissionMode: opts.permissionMode,
    });
    updateAgent(agentId, {
      status: info.status,
      parent_agent_id: info.parent_agent_id,
      created_at: info.created_at,
      model: info.model,
      runner_id: info.runner_id,
    });
    refetch(agentId).catch(() => {});

    return info;
  } catch (err) {
    removeAgent(agentId);
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
 * Send a user-authored message to an agent, the way the chat input does: the
 * host sends it now or queues it behind the turn in flight, checkpoints the
 * worktree and records the bubble. Use this from every call site that
 * programmatically messages an agent (chat input, conflict-fix dispatch,
 * command palette, etc.) so the transcript and status stay consistent.
 */
export async function sendUserMessageToAgent(
  agentId: string,
  text: string,
  images?: ImageAttachment[],
  displayText?: string,
): Promise<void> {
  const { queued } = await submitAgentMessage(agentId, text, {
    author: huddleAuthor(agentId),
    displayText,
    images,
  });
  if (!queued) {
    notifyMessageSent(agentId);
  }
}
