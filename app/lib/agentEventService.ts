import { listen, type UnlistenFn } from "../lib/events";
import { useConversationStore } from "../stores/conversationStore";
import { useAgentStore } from "../stores/agentStore";
import { sendAgentMessage } from "./ipc";
import type { ClaudeStreamEvent, PermissionRequest } from "./types";

/**
 * Singleton service that owns event subscriptions for agent stream events.
 * Decouples event subscription lifetime from React component lifetime.
 */

const listeners = new Map<string, UnlistenFn>();
const exitListeners = new Map<string, UnlistenFn>();
const permListeners = new Map<string, UnlistenFn>();

/** Subscribe to agent:event:{agentId} and agent:exit:{agentId}. */
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
      // In both cases, drain any queued messages (or transition to idle).
      if (
        parsed.type === "result" ||
        (parsed.type === "system" && parsed.subtype === "init")
      ) {
        drainNextQueued(agentId);
      }
    } catch {
      // Ignore malformed or non-JSON events (e.g. rate_limit_event)
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

  // Watch for permission requests from the PreToolUse hook.
  permListeners.set(agentId, () => {});

  listen<PermissionRequest>(`agent:permission:${agentId}`, (event) => {
    // The permission event can arrive before the assistant message with the
    // tool call has been processed. Retry a few times to handle the race.
    const store = useConversationStore.getState;
    const request = event.payload;
    const trySet = (attemptsLeft: number) => {
      const found = store().setPermissionPending(agentId, request);
      if (!found && attemptsLeft > 0) {
        setTimeout(() => trySet(attemptsLeft - 1), 100);
      }
    };
    trySet(10);
  }).then((unlisten) => {
    if (!permListeners.has(agentId)) {
      unlisten();
      return;
    }
    permListeners.set(agentId, unlisten);
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
}
