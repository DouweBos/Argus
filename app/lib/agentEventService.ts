import { listen, type UnlistenFn } from "../lib/events";
import { useConversationStore } from "../stores/conversationStore";
import { useAgentStore } from "../stores/agentStore";
import { sendAgentMessage } from "./ipc";
import type {
  AgentCapabilities,
  ClaudeStreamEvent,
  PermissionCancellation,
  PermissionRequest,
} from "./types";

/**
 * Singleton service that owns event subscriptions for agent stream events.
 * Decouples event subscription lifetime from React component lifetime.
 */

const listeners = new Map<string, UnlistenFn>();
const exitListeners = new Map<string, UnlistenFn>();
const permListeners = new Map<string, UnlistenFn>();
const permCancelListeners = new Map<string, UnlistenFn>();
const capListeners = new Map<string, UnlistenFn>();
const modelListeners = new Map<string, UnlistenFn>();
const permModeListeners = new Map<string, UnlistenFn>();

/** Subscribe to all agent event channels. */
export function startAgentListening(agentId: string): void {
  if (listeners.has(agentId)) return;

  // Store placeholder so we know listening has been requested
  listeners.set(agentId, () => {});

  listen<string>(`agent:event:${agentId}`, (event) => {
    try {
      const parsed: ClaudeStreamEvent = JSON.parse(event.payload);
      useConversationStore.getState().appendEvent(agentId, parsed);

      // A "result" event means Claude finished processing the current prompt.
      // A "system" init event means the CLI just started and is ready for input.
      // session_state_changed with state "idle" is the authoritative turn-over
      // signal — use it as the primary idle trigger.
      if (
        parsed.type === "result" ||
        (parsed.type === "system" && parsed.subtype === "init")
      ) {
        drainNextQueued(agentId);
      }

      // Authoritative idle/running signal from the CLI.
      if (
        parsed.type === "system" &&
        parsed.subtype === "session_state_changed"
      ) {
        if (parsed.state === "idle") {
          drainNextQueued(agentId);
        } else if (parsed.state === "running") {
          useAgentStore.getState().updateAgent(agentId, { status: "running" });
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

  listen<string>(`agent:exit:${agentId}`, () => {
    useAgentStore.getState().updateAgent(agentId, { status: "stopped" });
  }).then((unlisten) => {
    if (!exitListeners.has(agentId)) {
      unlisten();
      return;
    }
    exitListeners.set(agentId, unlisten);
  });

  // Watch for permission requests from the control protocol.
  // With the native control protocol, the assistant event (containing the
  // tool_use block) is always forwarded to the renderer *before* the
  // permission event is emitted, because the control_request arrives on a
  // subsequent stdout line. No retry loop needed.
  permListeners.set(agentId, () => {});

  listen<PermissionRequest>(`agent:permission:${agentId}`, (event) => {
    const store = useConversationStore.getState;
    const request = event.payload;
    const found = store().setPermissionPending(agentId, request);
    if (!found) {
      // Fallback: if the tool call hasn't been processed yet (unlikely but
      // possible during very fast streaming), retry a few times.
      let attempts = 3;
      const retry = () => {
        if (attempts-- > 0 && !store().setPermissionPending(agentId, request)) {
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
      useConversationStore.getState().cancelPermission(agentId, tool_use_id);
    },
  ).then((unlisten) => {
    if (!permCancelListeners.has(agentId)) {
      unlisten();
      return;
    }
    permCancelListeners.set(agentId, unlisten);
  });

  // Watch for capabilities from the initialize control_request response.
  capListeners.set(agentId, () => {});

  listen<AgentCapabilities>(
    `agent:capabilities:${agentId}`,
    (event) => {
      useConversationStore.getState().setCapabilities(agentId, event.payload);
      // The capabilities response means the CLI is initialized and ready for
      // input. Drain any queued messages or transition to idle — this replaces
      // the old bootstrap prompt that triggered system/init.
      drainNextQueued(agentId);
    },
  ).then((unlisten) => {
    if (!capListeners.has(agentId)) {
      unlisten();
      return;
    }
    capListeners.set(agentId, unlisten);
  });

  // Watch for model changes via the control protocol.
  modelListeners.set(agentId, () => {});

  listen<string>(`agent:model-changed:${agentId}`, (event) => {
    useConversationStore.getState().setModel(agentId, event.payload);
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
    useAgentStore.getState().updateAgent(agentId, {
      permission_mode: event.payload === "default" ? undefined : event.payload,
    });
  }).then((unlisten) => {
    if (!permModeListeners.has(agentId)) {
      unlisten();
      return;
    }
    permModeListeners.set(agentId, unlisten);
  });
}

/**
 * Pop the next queued message for an agent and send it.
 * If the queue is empty, set status to idle.
 */
function drainNextQueued(agentId: string): void {
  const store = useConversationStore.getState();
  const next = store.dequeueMessage(agentId);
  if (!next) {
    useAgentStore.getState().updateAgent(agentId, { status: "idle" });
    return;
  }
  // Move the queued message into the conversation timeline.
  store.addUserMessage(agentId, next.text);
  useAgentStore.getState().updateAgent(agentId, { status: "running" });
  sendAgentMessage(agentId, next.text, next.images).catch(() => {});
}

/** Unsubscribe all listeners for an agent. */
export function stopAgentListening(agentId: string): void {
  const unlisten = listeners.get(agentId);
  if (unlisten) unlisten();
  listeners.delete(agentId);

  const exitUnlisten = exitListeners.get(agentId);
  if (exitUnlisten) exitUnlisten();
  exitListeners.delete(agentId);

  const permUnlisten = permListeners.get(agentId);
  if (permUnlisten) permUnlisten();
  permListeners.delete(agentId);

  const permCancelUnlisten = permCancelListeners.get(agentId);
  if (permCancelUnlisten) permCancelUnlisten();
  permCancelListeners.delete(agentId);

  const capUnlisten = capListeners.get(agentId);
  if (capUnlisten) capUnlisten();
  capListeners.delete(agentId);

  const modelUnlisten = modelListeners.get(agentId);
  if (modelUnlisten) modelUnlisten();
  modelListeners.delete(agentId);

  const permModeUnlisten = permModeListeners.get(agentId);
  if (permModeUnlisten) permModeUnlisten();
  permModeListeners.delete(agentId);
}
