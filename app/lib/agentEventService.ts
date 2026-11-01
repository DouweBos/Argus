import type { AgentStatus } from "./types";
import { error } from "@logger";
import {
  addAgent,
  getAgentState,
  recordRecentlyClosed,
  removeAgent,
  updateAgent,
} from "../stores/agentStore";
import {
  clearConversation,
  firstUserText,
  flushPendingUnread,
  getConversationState,
} from "../stores/conversationStore";
import { unwatchQueue, watchQueue } from "../stores/queueStore";
import { type UnlistenFn, listen } from "./events";
import { stopAgent as apiStopAgent, listAgents } from "./ipc";
import { followTranscript } from "./transcriptSync";

/**
 * The agent-level events a window keeps its agent list current with. The
 * conversation itself is the host's: this only follows it
 * (`followTranscript`). Decouples subscription lifetime from React's.
 */

/**
 * Agents with a message sent but no idle back yet, so an early idle signal
 * (the CLI's init, a capabilities reply) doesn't hide the activity indicator.
 */
const inflight = new Set<string>();

const subscriptions = new Map<string, UnlistenFn[]>();

/**
 * Listen for agents spawned outside the UI flow (e.g. via the MCP
 * `spawn_agent` tool). Registers them in the agent store and starts
 * following them so they appear in the UI.
 */
export function initExternalAgentStarted(): void {
  listen<AgentStatus & { initial_prompt?: string }>(
    "agent:started",
    (event) => {
      const info = event.payload;
      if (getAgentState().agents[info.agent_id]) {
        return;
      }
      addAgent({
        agent_id: info.agent_id,
        session_id: info.session_id,
        status: info.status,
        permission_mode: info.permission_mode,
        parent_agent_id: info.parent_agent_id,
        created_at: info.created_at,
        model: info.model,
        runner_id: info.runner_id,
        pinned: info.pinned,
      });
      startAgentListening(info.agent_id);
      // An agent spawned without a prompt (the phone's "New agent") is idle and
      // waiting; only a prompted spawn is busy before its first event.
      if (info.initial_prompt) {
        notifyMessageSent(info.agent_id);
      }
    },
  );
}

/**
 * Pick up agents already live on the host when a project opens — pinned chats
 * the host resumed at boot can start before this window is listening.
 */
export async function hydrateLiveAgents(sessionIds: string[]): Promise<void> {
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      const live = await listAgents(sessionId).catch(() => []);
      for (const agent of live) {
        if (getAgentState().agents[agent.agent_id]) {
          continue;
        }
        addAgent(agent);
        startAgentListening(agent.agent_id);
      }
    }),
  );
}

/**
 * Stop an agent by ID — works for any agent (user-initiated or MCP-spawned).
 * Remembers it as recently closed, tears down listeners, asks the host to
 * stop it (which saves its history), then forgets it.
 */
export async function stopAgentById(agentId: string): Promise<void> {
  const agent = getAgentState().agents[agentId];
  const conv = getConversationState().conversations[agentId];
  if (agent) {
    const title =
      conv?.title?.trim() || firstUserText(conv)?.trim() || "Untitled agent";
    recordRecentlyClosed(agent.session_id, {
      agentId,
      runnerId: agent.runner_id,
      runnerSessionId: conv?.sessionId,
      closedAt: Date.now(),
      title: title.length > 60 ? title.slice(0, 60) + "…" : title,
    });
  }
  stopAgentListening(agentId);
  try {
    await apiStopAgent(agentId);
  } catch (err) {
    error(`Failed to stop agent ${agentId}:`, err);
  }
  clearConversation(agentId);
  removeAgent(agentId);
}

function on<T>(
  agentId: string,
  channel: string,
  handler: (payload: T) => void,
): void {
  listen<T>(`${channel}:${agentId}`, (event) => handler(event.payload)).then(
    (unlisten) => {
      const list = subscriptions.get(agentId);
      if (list) {
        list.push(unlisten);
      } else {
        // stopAgentListening ran before the listener was in place.
        unlisten();
      }
    },
  );
}

/** Follow an agent: its status, settings and conversation. */
export function startAgentListening(agentId: string): void {
  if (subscriptions.has(agentId)) {
    return;
  }
  subscriptions.set(agentId, []);
  const unfollow = followTranscript(agentId);
  subscriptions.get(agentId)!.push(unfollow);

  // Mirror the host queue for every live agent, not just the chats the user
  // has open — a message queued from the phone shows up here too.
  watchQueue(agentId);

  on<number>(agentId, "agent:exit", (exitCode) => {
    updateAgent(agentId, { status: exitCode === 0 ? "stopped" : "error" });
    inflight.delete(agentId);
    flushPendingUnread(agentId);
  });

  // The host's status is the CLI's own busy/idle state. Stopped/error stay
  // with the exit listener.
  on<string>(agentId, "agent:status", (status) => {
    if (status === "running" || status === "requires_action") {
      updateAgent(agentId, { status });
    } else if (status === "idle") {
      inflight.delete(agentId);
      trySetIdle(agentId);
    }
  });

  // The capabilities reply means the CLI is up and waiting for input.
  on<unknown>(agentId, "agent:capabilities", () => trySetIdle(agentId));

  // Mirrored onto the agent so a restart re-spawns with the latest choices.
  on<string>(agentId, "agent:model-changed", (model) =>
    updateAgent(agentId, { model }),
  );
  on<string>(agentId, "agent:runner-changed", (runnerId) =>
    updateAgent(agentId, { runner_id: runnerId }),
  );
  on<string>(agentId, "agent:permission-mode-changed", (mode) =>
    updateAgent(agentId, { permission_mode: mode || undefined }),
  );
  on<string | null>(agentId, "agent:effort-changed", (effort) =>
    updateAgent(agentId, { effort: effort ?? null }),
  );
  on<boolean>(agentId, "agent:pinned", (pinned) =>
    updateAgent(agentId, { pinned }),
  );
}

/** A message is on its way to the agent: show it busy until the turn ends. */
export function notifyMessageSent(agentId: string): void {
  inflight.add(agentId);
  updateAgent(agentId, { status: "running" });
}

/** Set the agent idle — unless a message it hasn't answered is in flight. */
function trySetIdle(agentId: string): void {
  if (inflight.has(agentId)) {
    return;
  }
  updateAgent(agentId, { status: "idle" });
  flushPendingUnread(agentId);
}

/** Unsubscribe all listeners for an agent and clean up tracking state. */
export function stopAgentListening(agentId: string): void {
  inflight.delete(agentId);
  unwatchQueue(agentId);
  subscriptions.get(agentId)?.forEach((unlisten) => unlisten());
  subscriptions.delete(agentId);
}
