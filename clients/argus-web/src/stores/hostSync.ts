/**
 * What a connection means for the domain stores: each event routed to the
 * store that owns it, the work a fresh channel does, and the reset a host
 * switch needs. The one module that knows every store; `connection.ts`
 * knows none, which keeps the stores free of import cycles.
 */

import type { EventEnvelope } from "@argus/remote-client";
import type { RemoteEventType } from "@argus/remote-protocol";
import { showRemoteNotification } from "../lib/notify";
import type { PayloadOf } from "../lib/protocol";
import {
  receiveAgentStatus,
  receiveCapabilities,
  receiveQueue,
  resetAgents,
} from "./agents";
import { installConnectionHooks } from "./connection";
import { receiveClaim, receiveDeviceState, resetDevices } from "./devices";
import { resetGit } from "./git";
import { receiveHuddleChat, receiveHuddleState } from "./huddle";
import { receiveListedAgentStatus, resetProjects } from "./projects";
import {
  cancelPrompt,
  flushPendingDecisions,
  receivePrompt,
  resetPrompts,
} from "./prompts";
import { pushWentOffline, registerPushOn, unregisterPush } from "./push";
import {
  receiveDelta,
  refreshUnlessFollowing,
  resetTranscripts,
} from "./transcripts";

type Handler = (event: EventEnvelope) => void;

/** Payloads are trusted as typed: the client validates nothing at runtime. */
function payload<E extends RemoteEventType>(event: EventEnvelope): PayloadOf<E> {
  return event.payload as PayloadOf<E>;
}

const HANDLERS: Partial<Record<RemoteEventType, Handler>> = {
  "permission.request": (ev) => {
    const prompt = payload<"permission.request">(ev);
    receivePrompt(prompt);
    // Refresh so the tool call renders its pending form inline.
    refreshUnlessFollowing(prompt.agent_id);
  },
  "permission.cancel": (ev) => {
    const { agent_id, tool_use_id } = payload<"permission.cancel">(ev);
    cancelPrompt(agent_id, tool_use_id);
    refreshUnlessFollowing(agent_id);
  },
  "agent.status": (ev) => {
    const agent = payload<"agent.status">(ev);
    receiveListedAgentStatus(agent);
    receiveAgentStatus(agent);
  },
  "agent.queue": (ev) => {
    if (ev.agent_id) {
      receiveQueue(ev.agent_id, payload<"agent.queue">(ev).messages);
    }
  },
  "agent.capabilities": (ev) => {
    if (ev.agent_id) {
      receiveCapabilities(ev.agent_id, payload<"agent.capabilities">(ev));
    }
  },
  "agent.transcript": (ev) => receiveDelta(payload<"agent.transcript">(ev)),
  // An older host sends no deltas: refetch the structured transcript.
  "agent.event": (ev) => {
    if (ev.agent_id) {
      refreshUnlessFollowing(ev.agent_id);
    }
  },
  notification: (ev) => showRemoteNotification(payload<"notification">(ev)),
  "device.state": (ev) => receiveDeviceState(payload<"device.state">(ev)),
  "device.claim": (ev) => receiveClaim(payload<"device.claim">(ev)),
  "huddle.chat": (ev) => receiveHuddleChat(payload<"huddle.chat">(ev)),
  "huddle.state": (ev) => receiveHuddleState(payload<"huddle.state">(ev)),
};

export function routeEvent(event: EventEnvelope): void {
  HANDLERS[event.event as RemoteEventType]?.(event);
}

/** Everything one host sent, gone before the next one's arrives. */
export function resetHostStores(): void {
  resetProjects();
  resetAgents();
  resetTranscripts();
  resetPrompts();
  resetGit();
  resetDevices();
}

let installed = false;

/** Wire the domain stores to the connection. Call once, before `init()`. */
export function installHostSync(): void {
  if (installed) {
    return;
  }
  installed = true;
  installConnectionHooks({
    event: routeEvent,
    ready: (transport, identity) => {
      if (!identity.account) {
        registerPushOn(transport);
      }
      flushPendingDecisions(transport).catch(() => {});
    },
    notReady: pushWentOffline,
    reset: resetHostStores,
    unpairing: unregisterPush,
  });
}
