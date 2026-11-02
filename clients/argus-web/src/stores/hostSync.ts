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
  resyncAgentStatuses,
  resyncQueues,
} from "./agents";
import { resetAutomations } from "./automations";
import { installConnectionHooks, watchLiveness } from "./connection";
import { resetDeviceHosts } from "./deviceHosts";
import { receiveClaim, receiveDeviceState, resetDevices } from "./devices";
import { resetFiles } from "./files";
import { receiveFileSearch, resetFileSearch } from "./fileSearch";
import { resetIntegrations } from "./integrations";
import { resetIssues } from "./issues";
import { resetGit } from "./git";
import {
  receiveTerminalData,
  receiveTerminalExit,
  resetTerminals,
  resyncTerminals,
} from "./terminals";
import { receiveHuddleChat, receiveHuddleState } from "./huddle";
import { resetAgentExtras, useAgentExtrasStore } from "./agentExtras";
import { resetChats, resyncStoppedChats } from "./chats";
import {
  receiveClaudeAccounts,
  receiveClaudeLogin,
  resetClaudeAccounts,
} from "./claudeAccounts";
import { installNotifications } from "./notifications";
import { resetSettings } from "./settings";
import { resetUsage } from "./usage";
import {
  receiveListedAgentStatus,
  receiveProjectsChanged,
  receiveSessionsChanged,
  resendViewing,
  resetProjects,
} from "./projects";
import { resetStart } from "./start";
import { resetProposals } from "./proposals";
import {
  cancelPrompt,
  flushPendingDecisions,
  receivePrompt,
  resetPrompts,
} from "./prompts";
import {
  connectionDown,
  connectionForgotten,
  connectionReady,
} from "../telemetry/connectionEvents";
import { pushWentOffline, registerPushOn, unregisterPush } from "./push";
import {
  receiveDelta,
  refreshUnlessFollowing,
  resetTranscripts,
  resyncTranscripts,
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
    if (agent.limit_stalled === false) {
      useAgentExtrasStore.getState().clearHandoff(agent.agent_id);
    }
  },
  "sessions.changed": (ev) => {
    receiveSessionsChanged(payload<"sessions.changed">(ev).repo_root);
    // A stopped agent becomes a saved chat; the session's history moves with it.
    resyncStoppedChats();
  },
  "projects.changed": () => receiveProjectsChanged(),
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
  "terminal.data": (ev) => {
    const { terminal_id, data } = payload<"terminal.data">(ev);
    receiveTerminalData(terminal_id, data, ev.seq);
  },
  "terminal.exit": (ev) => {
    const { terminal_id, exit_code } = payload<"terminal.exit">(ev);
    receiveTerminalExit(terminal_id, exit_code, ev.seq);
  },
  "files.search": (ev) => receiveFileSearch(payload<"files.search">(ev)),
  "claude_accounts.changed": (ev) =>
    receiveClaudeAccounts(payload<"claude_accounts.changed">(ev)),
  "claude_accounts.login": (ev) =>
    receiveClaudeLogin(payload<"claude_accounts.login">(ev)),
};

export function routeEvent(event: EventEnvelope): void {
  HANDLERS[event.event as RemoteEventType]?.(event);
}

/** Everything one host sent, gone before the next one's arrives. */
export function resetHostStores(): void {
  resetProjects();
  resetAgents();
  resetAgentExtras();
  resetChats();
  resetStart();
  resetTranscripts();
  resetPrompts();
  resetGit();
  resetFiles();
  resetFileSearch();
  resetTerminals();
  resetDevices();
  resetProposals();
  resetAutomations();
  resetUsage();
  resetClaudeAccounts();
  resetSettings();
  resetDeviceHosts();
  resetIntegrations();
  resetIssues();
}

let installed = false;

/**
 * A fresh channel, after a drop or a host restart: whatever happened while
 * we were away arrived on nobody's socket. The transport resubscribes the
 * agents we follow; this refetches what they would have told us. Lists
 * reload themselves, since their screens poll on `ready`.
 */
export function resyncAfterReconnect(): void {
  resyncTranscripts();
  resyncQueues();
  resyncAgentStatuses();
  resyncTerminals();
  resendViewing();
}

/** Wire the domain stores to the connection. Call once, before `init()`. */
export function installHostSync(): void {
  if (installed) {
    return;
  }
  installed = true;
  installNotifications();
  installConnectionHooks({
    event: routeEvent,
    ready: (transport, identity) => {
      if (!identity.account) {
        registerPushOn(transport);
      }
      flushPendingDecisions(transport).catch(() => {});
      resyncAfterReconnect();
      connectionReady();
    },
    notReady: () => {
      pushWentOffline();
      connectionDown();
    },
    reset: () => {
      connectionForgotten();
      resetHostStores();
    },
    unpairing: unregisterPush,
  });
  watchLiveness();
}
