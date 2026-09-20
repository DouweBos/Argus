import type { SavedConversation } from "./chatHistory";
import type {
  AgentCapabilities,
  AgentStatus,
  LlmStreamEvent,
  PermissionCancellation,
  PermissionRequest,
} from "./types";
import { error } from "@logger";
import {
  addAgent,
  getAgentState,
  recordRecentlyClosed,
  removeAgent,
  updateAgent,
} from "../stores/agentStore";
import {
  addUserMessage,
  appendEvent,
  appendSystemMessage,
  cancelPermission,
  clearConversation,
  clearPermission,
  flushPendingUnread,
  getConversationState,
  setCapabilities,
  setConversationTitle,
  setModel,
  setPermissionPending,
} from "../stores/conversationStore";
import {
  dequeueMessage,
  getQueuedMessages,
  unwatchQueue,
  useQueueStore,
  watchQueue,
} from "../stores/queueStore";
import { getSessionState } from "../stores/sessionStore";
import {
  isAwaitingAnswerTool,
  notifyAgentFinished,
  notifyAwaitingAnswer,
  notifyPermissionRequested,
} from "./agentNotifications";
import { deriveTitle } from "./chatHistory";
import { type UnlistenFn, listen } from "./events";
import {
  createCheckpoint,
  generateSessionTitle,
  type ImageAttachment,
  publishAgentSnapshot,
  saveChatHistory,
  sendAgentMessage,
  stopAgent as apiStopAgent,
} from "./ipc";

/**
 * Singleton service that owns event subscriptions for agent stream events.
 * Decouples event subscription lifetime from React component lifetime.
 */

/**
 * Tracks per-agent debounce timers for incremental saves during an active
 * conversation. A window reload or crash would otherwise drop the chat —
 * writing through to disk on each completed exchange means at most the
 * in-flight turn is lost.
 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 500;

/**
 * Tracks agents that have already had (or are currently having) a title
 * generated so we only fire the background `claude -p` call once per agent.
 */
const titleRequested = new Set<string>();

/**
 * Kick off a background title-generation call for the agent if we haven't
 * already. Fire-and-forget — the promise resolves into the conversation
 * store and updates the UI wherever `conv.title` is read.
 */
export function maybeGenerateTitle(agentId: string, firstMessage: string) {
  if (titleRequested.has(agentId)) {
    return;
  }
  // Resumed conversations already carry a title — don't regenerate it from
  // the first follow-up message.
  if (getConversationState().conversations[agentId]?.title) {
    titleRequested.add(agentId);

    return;
  }
  const text = firstMessage.trim();
  if (!text) {
    return;
  }
  titleRequested.add(agentId);

  generateSessionTitle(text)
    .then((title) => {
      if (!title) {
        return;
      }
      // Only set if the agent still exists and hasn't been given one via
      // a resumed conversation in the meantime.
      const conv = getConversationState().conversations[agentId];
      if (!conv || conv.title) {
        return;
      }
      setConversationTitle(agentId, title);
    })
    .catch(() => {
      // Allow a retry on the next user message if the CLI call failed.
      titleRequested.delete(agentId);
    });
}

/**
 * Publish the current in-memory conversation to the backend so other windows
 * (notably a freshly opened agent popout) can hydrate without waiting for the
 * next live event. Fire-and-forget; best-effort.
 */
function publishSnapshot(agentId: string): void {
  const conv = getConversationState().conversations[agentId];
  if (!conv) {
    return;
  }
  try {
    publishAgentSnapshot(agentId, JSON.stringify(conv)).catch(() => {});
  } catch {
    // Circular refs / huge payloads — skip rather than crash.
  }
}

/**
 * Build a SavedConversation from the current store state and persist it.
 * No-op if the conversation has no messages or was already saved.
 */
export function saveAgentConversation(agentId: string): void {
  const timer = saveTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(agentId);
  }

  publishSnapshot(agentId);

  const conv = getConversationState().conversations[agentId];
  if (!conv || conv.messages.length === 0) {
    return;
  }
  // Upsert-by-sessionId on the backend requires a real sessionId. Skip if
  // we haven't received the `system:init` event yet — the exit/quit/stop
  // paths will catch it later.
  if (!conv.sessionId) {
    return;
  }

  const agent = getAgentState().agents[agentId];
  if (!agent) {
    return;
  }

  const wsState = getSessionState();
  const session = wsState.sessions.find((w) => w.id === agent.session_id);
  if (!session) {
    return;
  }

  const saved: SavedConversation = {
    id: crypto.randomUUID(),
    sessionId: conv.sessionId,
    agentId,
    title: conv.title ?? deriveTitle(conv.messages),
    sessionBranch: session.branch ?? "",
    sessionDescription: session.description ?? "",
    model: conv.model,
    totalCost: conv.totalCost,
    totalDuration: conv.totalDuration,
    messageCount: conv.messages.length,
    createdAt: conv.messages[0]?.timestamp ?? Date.now(),
    endedAt: Date.now(),
    messages: conv.messages,
  };

  // Fire-and-forget — saving is best-effort. The backend upserts by sessionId
  // so repeated calls during a live chat overwrite the on-disk record.
  saveChatHistory(session.repo_root, saved).catch(() => {});
}

/**
 * Debounced incremental save — coalesces bursts of events into a single
 * write. Called on every meaningful conversation change.
 */
export function scheduleAgentSave(agentId: string): void {
  const existing = saveTimers.get(agentId);
  if (existing) {
    clearTimeout(existing);
  }
  const t = setTimeout(() => {
    saveTimers.delete(agentId);
    saveAgentConversation(agentId);
  }, SAVE_DEBOUNCE_MS);
  saveTimers.set(agentId, t);
}

/**
 * Listen for app quit and save all active conversations.
 * Called once at app startup.
 */
export function initAppQuitSave(): void {
  listen<undefined>("app:will-quit", () => {
    const agents = getAgentState().agents;
    for (const agentId of Object.keys(agents)) {
      saveAgentConversation(agentId);
    }
  });

  // Flush on window reload / close so a debounced save in flight is committed
  // before the renderer tears down.
  window.addEventListener("beforeunload", () => {
    const agents = getAgentState().agents;
    for (const agentId of Object.keys(agents)) {
      saveAgentConversation(agentId);
    }
  });
}

/**
 * Listen for agents spawned outside the UI flow (e.g. via the MCP
 * `spawn_agent` tool). Registers them in the agent store and starts
 * subscribing to their event channels so they appear in the UI.
 */
export function initExternalAgentStarted(): void {
  listen<AgentStatus>("agent:started", (event) => {
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
    });
    startAgentListening(info.agent_id);
    // Derive a human-readable title from the prompt the MCP tool sent.
    // Without this, the Agents overview falls back to the branch name for
    // MCP-spawned agents, since the renderer never sees the first user
    // message (it is written to stdin by the backend).
    if (info.initial_prompt) {
      maybeGenerateTitle(info.agent_id, info.initial_prompt);
    }
    // MCP-spawned agents receive an initial prompt from the backend before
    // the renderer gets a chance to subscribe. Mark the session as in-flight
    // so early `system:init` / `session_state_changed(idle)` signals don't
    // flip the agent to "idle" while it's actually still processing the
    // initial prompt.
    inflight.add(info.agent_id);
    updateAgent(info.agent_id, { status: "running" });
  });
}

/**
 * Stop an agent by ID — works for any agent (user-initiated or MCP-spawned).
 * Saves the conversation, tears down listeners, calls the backend to kill
 * the process, then removes the agent from the store.
 */
export async function stopAgentById(agentId: string): Promise<void> {
  saveAgentConversation(agentId);
  const agent = getAgentState().agents[agentId];
  const conv = getConversationState().conversations[agentId];
  if (agent) {
    const firstUserText = conv?.messages.find((m) => m.role === "user")
      ?.textBlocks[0];
    const title =
      conv?.title?.trim() || firstUserText?.trim() || "Untitled agent";
    recordRecentlyClosed(agent.session_id, {
      agentId,
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

const listeners = new Map<string, UnlistenFn>();
const exitListeners = new Map<string, UnlistenFn>();
const permListeners = new Map<string, UnlistenFn>();
const permCancelListeners = new Map<string, UnlistenFn>();
const permResolvedListeners = new Map<string, UnlistenFn>();
const capListeners = new Map<string, UnlistenFn>();
const modelListeners = new Map<string, UnlistenFn>();
const permModeListeners = new Map<string, UnlistenFn>();
const effortListeners = new Map<string, UnlistenFn>();
const stderrListeners = new Map<string, UnlistenFn>();
const mcpMessageListeners = new Map<string, UnlistenFn>();
const remoteMessageListeners = new Map<string, UnlistenFn>();
const statusListeners = new Map<string, UnlistenFn>();

/**
 * Payload emitted by the Electron main process when the MCP server injects
 * a prompt or follow-up into an agent. Mirrors
 * `McpSystemMessagePayload` on the backend.
 */
interface McpSystemMessagePayload {
  images?: { data: string; media_type: string }[];
  message: string;
  parentAgentId?: string;
  parentLabel?: string;
  timestamp: number;
  tool:
    | "create_session"
    | "send_agent_message"
    | "spawn_agent"
    | "spawn_agents_batch";
}

/**
 * Grace period before announcing a question or plan. One that is approved
 * outright resolves within a tick, and notifying for that would be noise.
 */
const AWAITING_ANSWER_GRACE_MS = 750;

/** Announce a prompt only if it is genuinely still waiting on the user. */
function notifyIfStillUnanswered(
  agentId: string,
  toolUseId: string,
  toolName: string,
): void {
  setTimeout(() => {
    const conv = getConversationState().conversations[agentId];
    const answered = conv?.messages.some((m) =>
      m.toolCalls.some((tc) => tc.id === toolUseId && tc.result !== undefined),
    );
    if (!answered) {
      notifyAwaitingAnswer(agentId, toolUseId, toolName);
    }
  }, AWAITING_ANSWER_GRACE_MS);
}

/** Subscribe to all agent event channels. */
export function startAgentListening(agentId: string): void {
  if (listeners.has(agentId)) {
    return;
  }

  // Store placeholder so we know listening has been requested
  listeners.set(agentId, () => {});

  // Mirror the backend queue for every live agent, not just the chats the user
  // has open — otherwise a message queued from the phone is invisible here and
  // never drains when the turn ends.
  watchQueue(agentId);

  listen<string>(`agent:event:${agentId}`, (event) => {
    try {
      const parsed: LlmStreamEvent = JSON.parse(event.payload);
      appendEvent(agentId, parsed);
      scheduleAgentSave(agentId);

      // A question or plan can land without a permission request behind it —
      // in `auto` mode the CLI approves these itself — so announce them here.
      // Duplicate calls are dropped, so the permission path can also fire.
      if (parsed.type === "assistant") {
        for (const block of parsed.message.content) {
          if (block.type === "tool_use" && isAwaitingAnswerTool(block.name)) {
            notifyIfStillUnanswered(agentId, block.id, block.name);
          }
        }
      }

      // A "result" event means Claude finished processing the current prompt.
      // Clear the in-flight flag and drain queued messages. If nothing is
      // queued, transition to idle — we cannot rely solely on a subsequent
      // session_state_changed(idle) because it may arrive before result
      // (creating a race where trySetIdle is blocked by inflight) or not
      // arrive at all for text-only responses.
      if (parsed.type === "result") {
        inflight.delete(agentId);
        const drained = trySendNextQueued(agentId);
        if (!drained) {
          trySetIdle(agentId);
          notifyAgentFinished(
            agentId,
            parsed.duration_ms,
            parsed.subtype === "error" ? "error" : "success",
          );
        }
      }

      // A "system" init event means the CLI just started and is ready for
      // input.  Try to drain queued messages; set idle only if nothing is
      // in-flight.
      if (parsed.type === "system" && parsed.subtype === "init") {
        if (!trySendNextQueued(agentId)) {
          trySetIdle(agentId);
        }
      }

      // Authoritative idle/running signal from the CLI.
      if (
        parsed.type === "system" &&
        parsed.subtype === "session_state_changed"
      ) {
        if (parsed.state === "idle") {
          if (!trySendNextQueued(agentId)) {
            trySetIdle(agentId);
          }
        } else if (parsed.state === "running") {
          updateAgent(agentId, { status: "running" });
        }
      }
    } catch {
      // Ignore malformed or non-JSON events (e.g. unknown system subtypes)
    }
  }).then((unlisten) => {
    if (!listeners.has(agentId)) {
      // stopAgentListening was called before promise resolved
      unlisten();

      return;
    }

    listeners.set(agentId, unlisten);
  });

  // Also watch for agent process exit
  exitListeners.set(agentId, () => {});

  listen<number>(`agent:exit:${agentId}`, (event) => {
    const exitCode = event.payload;
    const status = exitCode === 0 ? "stopped" : "error";
    // Save conversation before updating status (data still in store)
    saveAgentConversation(agentId);
    updateAgent(agentId, { status });
    inflight.delete(agentId);
    flushPendingUnread(agentId);
  }).then((unlisten) => {
    if (!exitListeners.has(agentId)) {
      unlisten();

      return;
    }

    exitListeners.set(agentId, unlisten);
  });

  // Reflect the backend's authoritative "running" transition — set when a
  // prompt is injected from anywhere (remote web client, MCP), which the
  // renderer would otherwise miss since it only marks running on its own sends.
  // Running-only on purpose: idle/stopped stay with the queue-aware handlers.
  statusListeners.set(agentId, () => {});
  listen<string>(`agent:status:${agentId}`, (event) => {
    if (event.payload === "running") {
      updateAgent(agentId, { status: "running" });
    }
  }).then((unlisten) => {
    if (!statusListeners.has(agentId)) {
      unlisten();

      return;
    }

    statusListeners.set(agentId, unlisten);
  });

  // Watch for permission requests from the control protocol.
  // With the native control protocol, the assistant event (containing the
  // tool_use block) is always forwarded to the renderer *before* the
  // permission event is emitted, because the control_request arrives on a
  // subsequent stdout line. No retry loop needed.
  permListeners.set(agentId, () => {});

  listen<PermissionRequest>(`agent:permission:${agentId}`, (event) => {
    const request = event.payload;
    notifyPermissionRequested(agentId, request);
    const found = setPermissionPending(agentId, request);
    if (!found) {
      // Fallback: if the tool call hasn't been processed yet (fast streaming,
      // or a nested subagent tool_use whose block is still being folded in),
      // retry over ~1s so the prompt is never silently dropped.
      let attempts = 20;
      const retry = () => {
        if (attempts-- > 0 && !setPermissionPending(agentId, request)) {
          setTimeout(retry, 50);
        }
      };

      setTimeout(retry, 50);
    }
  }).then((unlisten) => {
    if (!permListeners.has(agentId)) {
      unlisten();

      return;
    }

    permListeners.set(agentId, unlisten);
  });

  // Watch for permission cancellations (CLI withdrew the request).
  permCancelListeners.set(agentId, () => {});

  listen<PermissionCancellation>(
    `agent:permission-cancel:${agentId}`,
    (event) => {
      const { tool_use_id } = event.payload;
      cancelPermission(agentId, tool_use_id);
    },
  ).then((unlisten) => {
    if (!permCancelListeners.has(agentId)) {
      unlisten();

      return;
    }

    permCancelListeners.set(agentId, unlisten);
  });

  // A prompt was answered — possibly by a remote (web) client, whose response
  // goes straight to the CLI and never touches this store. Clear the pending
  // state and republish the snapshot so the desktop and other clients update.
  permResolvedListeners.set(agentId, () => {});

  listen<{ tool_use_id: string }>(
    `agent:permission-resolved:${agentId}`,
    (event) => {
      clearPermission(agentId, event.payload.tool_use_id);
      // Publish immediately (not debounced) so remote clients see the prompt
      // resolve right after they answer, rather than lagging a save cycle.
      saveAgentConversation(agentId);
    },
  ).then((unlisten) => {
    if (!permResolvedListeners.has(agentId)) {
      unlisten();

      return;
    }

    permResolvedListeners.set(agentId, unlisten);
  });

  // Watch for capabilities from the initialize control_request response.
  capListeners.set(agentId, () => {});

  listen<AgentCapabilities>(`agent:capabilities:${agentId}`, (event) => {
    setCapabilities(agentId, event.payload);
    // The capabilities response means the CLI is initialized and ready for
    // input. Drain any queued messages or transition to idle — but only if
    // nothing is already in-flight.
    if (!trySendNextQueued(agentId)) {
      trySetIdle(agentId);
    }
  }).then((unlisten) => {
    if (!capListeners.has(agentId)) {
      unlisten();

      return;
    }

    capListeners.set(agentId, unlisten);
  });

  // Watch for model changes via the control protocol.
  modelListeners.set(agentId, () => {});

  listen<string>(`agent:model-changed:${agentId}`, (event) => {
    setModel(agentId, event.payload);
    // Mirror onto agentStore so a later restartAgent / restoreAgentAtTurn
    // sees the most recent model when re-spawning.
    updateAgent(agentId, { model: event.payload });
  }).then((unlisten) => {
    if (!modelListeners.has(agentId)) {
      unlisten();

      return;
    }

    modelListeners.set(agentId, unlisten);
  });

  // Watch for permission mode changes via the control protocol.
  permModeListeners.set(agentId, () => {});

  listen<string>(`agent:permission-mode-changed:${agentId}`, (event) => {
    updateAgent(agentId, {
      permission_mode: event.payload || undefined,
    });
  }).then((unlisten) => {
    if (!permModeListeners.has(agentId)) {
      unlisten();

      return;
    }

    permModeListeners.set(agentId, unlisten);
  });

  // Watch for reasoning-effort changes via the control protocol.
  effortListeners.set(agentId, () => {});

  listen<string | null>(`agent:effort-changed:${agentId}`, (event) => {
    updateAgent(agentId, {
      effort: event.payload ?? null,
    });
  }).then((unlisten) => {
    if (!effortListeners.has(agentId)) {
      unlisten();

      return;
    }

    effortListeners.set(agentId, unlisten);
  });

  // Watch for stderr output from the CLI process (auth errors, diagnostics).
  stderrListeners.set(agentId, () => {});

  // Watch for MCP-injected messages (spawn_agent prompt, send_agent_message).
  mcpMessageListeners.set(agentId, () => {});

  listen<McpSystemMessagePayload>(`agent:mcp-message:${agentId}`, (event) => {
    const payload = event.payload;
    appendSystemMessage(agentId, {
      id: crypto.randomUUID(),
      role: "system",
      textBlocks: [payload.message],
      toolCalls: [],
      images: payload.images?.length ? payload.images : undefined,
      timestamp: payload.timestamp ?? Date.now(),
      source: {
        kind: "mcp",
        tool: payload.tool,
        parentAgentId: payload.parentAgentId,
        parentLabel: payload.parentLabel,
      },
    });
    scheduleAgentSave(agentId);
  }).then((unlisten) => {
    if (!mcpMessageListeners.has(agentId)) {
      unlisten();

      return;
    }

    mcpMessageListeners.set(agentId, unlisten);
  });

  // Messages sent from a remote (web) control client: the backend wrote them to
  // the CLI's stdin, but only the initiating renderer records the user bubble —
  // so mirror them here into a real user message the transcript (and snapshot)
  // can show.
  remoteMessageListeners.set(agentId, () => {});
  listen<{
    author?: string | null;
    images?: ImageAttachment[];
    message: string;
  }>(`agent:remote-message:${agentId}`, (event) => {
    const { message, images, author } = event.payload;
    addUserMessage(agentId, message, images, undefined, author ?? undefined);
    maybeGenerateTitle(agentId, message);
    scheduleAgentSave(agentId);
  }).then((unlisten) => {
    if (!remoteMessageListeners.has(agentId)) {
      unlisten();

      return;
    }
    remoteMessageListeners.set(agentId, unlisten);
  });

  listen<string>(`agent:stderr:${agentId}`, (event) => {
    const line = event.payload;
    if (!line) {
      return;
    }
    appendSystemMessage(agentId, {
      id: crypto.randomUUID(),
      role: "system",
      isError: true,
      textBlocks: [line],
      toolCalls: [],
      timestamp: Date.now(),
    });
  }).then((unlisten) => {
    if (!stderrListeners.has(agentId)) {
      unlisten();

      return;
    }

    stderrListeners.set(agentId, unlisten);
  });
}

/**
 * Tracks agent IDs that have an outstanding message (sent, no result yet).
 * Guards against stale `session_state_changed(idle)` signals setting the
 * agent to idle while it's still processing.
 */
const inflight = new Set<string>();

/**
 * Mark an agent as having an in-flight message.  Call this whenever a
 * message is sent directly (not via the queue).
 */
export function notifyMessageSent(agentId: string): void {
  inflight.add(agentId);
  scheduleAgentSave(agentId);
}

/**
 * If the queue has a message, dequeue it, send it, and mark in-flight.
 * Returns true if a message was sent.
 *
 * Bails when a message is already in-flight so that overlapping `result`
 * and `session_state_changed(idle)` signals don't drain multiple queued
 * messages back-to-back without waiting for each turn to finish.
 */
function trySendNextQueued(agentId: string): boolean {
  if (inflight.has(agentId)) {
    return false;
  }
  // The queue lives in the backend; this reads the mirrored copy to decide
  // synchronously, then pops for real. Claiming `inflight` before the await
  // keeps a second caller from draining underneath this one.
  if (getQueuedMessages(agentId).length === 0) {
    return false;
  }
  inflight.add(agentId);
  updateAgent(agentId, { status: "running" });

  const sessionId = getAgentState().agents[agentId]?.session_id;
  (async () => {
    const next = await dequeueMessage(agentId);
    if (!next) {
      inflight.delete(agentId);
      trySetIdle(agentId);

      return;
    }

    // Capture a checkpoint right before the prompt is dispatched so the user
    // can later revert the worktree to its pre-prompt state. Best-effort —
    // a git failure shouldn't block the queued send.
    let checkpointId: string | undefined;
    if (sessionId) {
      try {
        const cp = await createCheckpoint(sessionId);
        checkpointId = cp.id;
      } catch {
        // Skip checkpoint.
      }
    }
    addUserMessage(agentId, next.text, next.images, checkpointId, next.author);
    sendAgentMessage(agentId, next.text, next.images).catch(() => {});
    scheduleAgentSave(agentId);
  })().catch(() => {});

  return true;
}

/**
 * A message queued from another client (phone, web) can land after the agent
 * has already gone idle, so no `result` or idle event follows to drain it.
 * Watch the mirrored queue and dispatch as soon as one shows up.
 */
useQueueStore.subscribe((state, prev) => {
  for (const [agentId, messages] of Object.entries(state.queues)) {
    if (messages.length === 0 || messages === prev.queues[agentId]) {
      continue;
    }
    if (getAgentState().agents[agentId]?.status !== "idle") {
      continue;
    }
    trySendNextQueued(agentId);
  }
});

/**
 * Set the agent to idle — but only if no message is currently in-flight.
 * This prevents stale idle signals from hiding the activity indicator.
 */
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
  const unlisten = listeners.get(agentId);
  if (unlisten) {
    unlisten();
  }
  listeners.delete(agentId);

  const exitUnlisten = exitListeners.get(agentId);
  if (exitUnlisten) {
    exitUnlisten();
  }
  exitListeners.delete(agentId);

  const statusUnlisten = statusListeners.get(agentId);
  if (statusUnlisten) {
    statusUnlisten();
  }
  statusListeners.delete(agentId);

  const permUnlisten = permListeners.get(agentId);
  if (permUnlisten) {
    permUnlisten();
  }
  permListeners.delete(agentId);

  const permCancelUnlisten = permCancelListeners.get(agentId);
  if (permCancelUnlisten) {
    permCancelUnlisten();
  }
  permCancelListeners.delete(agentId);

  const permResolvedUnlisten = permResolvedListeners.get(agentId);
  if (permResolvedUnlisten) {
    permResolvedUnlisten();
  }
  permResolvedListeners.delete(agentId);

  const capUnlisten = capListeners.get(agentId);
  if (capUnlisten) {
    capUnlisten();
  }
  capListeners.delete(agentId);

  const modelUnlisten = modelListeners.get(agentId);
  if (modelUnlisten) {
    modelUnlisten();
  }
  modelListeners.delete(agentId);

  const permModeUnlisten = permModeListeners.get(agentId);
  if (permModeUnlisten) {
    permModeUnlisten();
  }
  permModeListeners.delete(agentId);

  const effortUnlisten = effortListeners.get(agentId);
  if (effortUnlisten) {
    effortUnlisten();
  }
  effortListeners.delete(agentId);

  const stderrUnlisten = stderrListeners.get(agentId);
  if (stderrUnlisten) {
    stderrUnlisten();
  }
  stderrListeners.delete(agentId);

  const mcpUnlisten = mcpMessageListeners.get(agentId);
  if (mcpUnlisten) {
    mcpUnlisten();
  }
  mcpMessageListeners.delete(agentId);

  const remoteUnlisten = remoteMessageListeners.get(agentId);
  if (remoteUnlisten) {
    remoteUnlisten();
  }
  remoteMessageListeners.delete(agentId);
}
