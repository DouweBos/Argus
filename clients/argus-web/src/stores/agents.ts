/**
 * Per-agent state and control: status, input-picker capabilities, effort and
 * the computer-side message queue. Mirrors `HostStore+Control`. Control
 * methods need the "control" grant; the host refuses them otherwise.
 */

import { create } from "zustand";
import { resendText } from "@argus/client-core";
import type {
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteImageAttachment,
  RemoteMessage,
  RemotePermissionMode,
  RemoteQueuedMessage,
} from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";
import { receiveListedAgentStatus } from "./projects";

export interface ForkRequest {
  into: "agent" | "session";
  description: string;
  branch: string;
}

interface AgentsState {
  /** Latest known status per agent (drives the input's Send/Stop + pills). */
  statusByAgent: Record<string, RemoteAgentStatus>;
  /** Input pickers' data (models/commands/subagents) per agent. */
  capabilitiesByAgent: Record<string, RemoteAgentCapabilities>;
  /** Locally-chosen effort per agent (the status doesn't carry it). */
  effortByAgent: Record<string, string | null>;
  /** Messages parked on the computer until each agent's turn ends. */
  queuedByAgent: Record<string, RemoteQueuedMessage[]>;

  loadAgentStatus: (agentId: string) => Promise<void>;
  setEffortLocal: (agentId: string, level: string | null) => void;
  loadCapabilities: (agentId: string) => Promise<void>;
  /** Park a message on the computer's queue until the agent's turn ends. */
  queueMessage: (
    agentId: string,
    message: string,
    images: RemoteImageAttachment[] | undefined,
    displayText: string,
  ) => Promise<void>;
  /** Drop a still-queued message before it's sent. */
  removeQueued: (agentId: string, id: string) => Promise<void>;
  updateQueued: (agentId: string, id: string, message: string) => Promise<void>;
  /** Send one queued message ahead of the rest, into a busy agent's turn. */
  sendQueuedNow: (agentId: string, id: string) => Promise<void>;
  /** Fetch the computer's queue for an agent (then follow `agent.queue`). */
  loadQueue: (agentId: string) => Promise<void>;
  interrupt: (agentId: string) => Promise<void>;
  /** Cancel the continue scheduled after a usage limit. */
  dismissLimitResume: (agentId: string) => Promise<void>;
  setModel: (agentId: string, model: string) => Promise<void>;
  setPermissionMode: (
    agentId: string,
    mode: RemotePermissionMode,
  ) => Promise<void>;
  setEffort: (agentId: string, level: string | null) => Promise<void>;
  spawnAgent: (
    sessionId: string,
    opts?: {
      model?: string;
      permissionMode?: RemotePermissionMode;
      runnerId?: string;
      /** Resume a stopped chat's conversation instead of starting empty. */
      resumeSessionId?: string;
    },
  ) => Promise<RemoteAgentStatus>;
  stopAgentProcess: (agentId: string) => Promise<void>;
  /** Pin a live agent so the computer resumes it on its next start, or unpin it. */
  setPinned: (agentId: string, pinned: boolean) => Promise<void>;
  /** Rewind to just before `message` and send `edited` in its place. Throws the host's reason. */
  rewind: (
    agentId: string,
    message: RemoteMessage,
    edited: string,
  ) => Promise<void>;
  /** Fork the chat up to `message` into a new agent. Throws the host's reason. */
  fork: (
    agentId: string,
    message: RemoteMessage,
    request: ForkRequest,
  ) => Promise<{ sessionId: string; agent: RemoteAgentStatus }>;
  /** Follow an agent's live events (deltas, prompts) while it is on screen. */
  watchAgent: (agentId: string, on: boolean) => void;
}

const EMPTY = {
  statusByAgent: {},
  capabilitiesByAgent: {},
  effortByAgent: {},
  queuedByAgent: {},
} satisfies Partial<AgentsState>;

function connected() {
  const t = currentTransport();
  if (!t) {
    throw new Error("not connected");
  }

  return t;
}

export const useAgentsStore = create<AgentsState>()((set, get) => ({
  ...EMPTY,

  loadAgentStatus: async (agentId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { agent } = await request(t, "agents.status", {
        agent_id: agentId,
      });
      set((s) => ({ statusByAgent: { ...s.statusByAgent, [agentId]: agent } }));
    } catch {
      // The agent may be gone; leave any prior status in place.
    }
  },

  setEffortLocal: (agentId, level) => {
    set((s) => ({ effortByAgent: { ...s.effortByAgent, [agentId]: level } }));
  },

  loadCapabilities: async (agentId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { capabilities } = await request(t, "agents.capabilities", {
      agent_id: agentId,
    });
    set((s) => ({
      capabilitiesByAgent: { ...s.capabilitiesByAgent, [agentId]: capabilities },
    }));
  },

  queueMessage: async (agentId, message, images, displayText) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    // The computer owns the queue, so it outlives this tab and the desktop
    // is what eventually drains it.
    await request(t, "agents.queue_add", {
      agent_id: agentId,
      message,
      ...(displayText && displayText !== message
        ? { display_text: displayText }
        : {}),
      ...(images?.length ? { images } : {}),
    });
  },

  removeQueued: async (agentId, id) => {
    const t = currentTransport();
    if (t) {
      await request(t, "agents.queue_remove", { agent_id: agentId, id });
    }
  },

  updateQueued: async (agentId, id, message) => {
    // The edit lands on the computer and comes back on `agent.queue`.
    const t = currentTransport();
    if (t) {
      await request(t, "agents.queue_update", {
        agent_id: agentId,
        id,
        message,
      });
    }
  },

  sendQueuedNow: async (agentId, id) => {
    const t = currentTransport();
    if (t) {
      await request(t, "agents.queue_send_now", { agent_id: agentId, id });
    }
  },

  loadQueue: async (agentId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { messages } = await request(t, "agents.queue_list", {
      agent_id: agentId,
    });
    set((s) => ({ queuedByAgent: { ...s.queuedByAgent, [agentId]: messages } }));
  },

  interrupt: async (agentId) => {
    const t = currentTransport();
    if (t) {
      await request(t, "agents.interrupt", { agent_id: agentId });
    }
  },

  dismissLimitResume: async (agentId) => {
    const t = currentTransport();
    if (t) {
      await request(t, "agents.dismiss_limit_resume", { agent_id: agentId });
    }
  },

  setModel: async (agentId, model) => {
    const t = currentTransport();
    if (t) {
      await request(t, "agents.set_model", { agent_id: agentId, model });
    }
  },

  setPermissionMode: async (agentId, mode) => {
    const t = currentTransport();
    if (t) {
      await request(t, "agents.set_permission_mode", {
        agent_id: agentId,
        mode,
      });
    }
  },

  setEffort: async (agentId, level) => {
    get().setEffortLocal(agentId, level);
    const t = currentTransport();
    if (t) {
      await request(t, "agents.set_effort", { agent_id: agentId, level });
    }
  },

  spawnAgent: async (sessionId, opts) => {
    const { agent } = await request(connected(), "agents.spawn", {
      session_id: sessionId,
      ...(opts?.model ? { model: opts.model } : {}),
      ...(opts?.permissionMode ? { permission_mode: opts.permissionMode } : {}),
      ...(opts?.runnerId ? { runner_id: opts.runnerId } : {}),
      ...(opts?.resumeSessionId
        ? { resume_session_id: opts.resumeSessionId }
        : {}),
    });
    receiveAgentStatus(agent);
    receiveListedAgentStatus(agent);

    return agent;
  },

  stopAgentProcess: async (agentId) => {
    // Status flips to "stopped" via the forwarded agent.status broadcast.
    const t = currentTransport();
    if (t) {
      await request(t, "agents.stop", { agent_id: agentId });
    }
  },

  setPinned: async (agentId, pinned) => {
    // The host owns the pin and captures its telemetry; its answer is the truth.
    const result = await request(connected(), "agents.set_pinned", {
      agent_id: agentId,
      pinned,
    });
    set((s) => {
      const status = s.statusByAgent[agentId];

      return status
        ? {
            statusByAgent: {
              ...s.statusByAgent,
              [agentId]: { ...status, pinned: result.pinned },
            },
          }
        : {};
    });
  },

  rewind: async (agentId, message, edited) => {
    await request(connected(), "agents.rewind", {
      agent_id: agentId,
      message_id: message.id,
      text: resendText(message, edited),
    });
  },

  fork: async (agentId, message, { into, description, branch }) => {
    const result = await request(connected(), "agents.fork", {
      agent_id: agentId,
      message_id: message.id,
      into,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(branch.trim() ? { branch: branch.trim() } : {}),
    });
    receiveAgentStatus(result.agent);
    receiveListedAgentStatus(result.agent);
    if (result.agent.effort) {
      get().setEffortLocal(result.agent.agent_id, result.agent.effort);
    }

    return { sessionId: result.session_id, agent: result.agent };
  },

  watchAgent: (agentId, on) => {
    currentTransport()?.subscribe(agentId, on);
  },
}));

/** `agent.status`: the latest word on one agent. */
export function receiveAgentStatus(agent: RemoteAgentStatus): void {
  useAgentsStore.setState((s) => ({
    statusByAgent: { ...s.statusByAgent, [agent.agent_id]: agent },
  }));
}

/** `agent.queue`: the computer's queue for one agent, outright. */
export function receiveQueue(
  agentId: string,
  messages: RemoteQueuedMessage[],
): void {
  useAgentsStore.setState((s) => ({
    queuedByAgent: { ...s.queuedByAgent, [agentId]: messages },
  }));
}

/** `agent.capabilities`: pickers become available once the CLI handshake completes. */
export function receiveCapabilities(
  agentId: string,
  capabilities: RemoteAgentCapabilities,
): void {
  useAgentsStore.setState((s) => ({
    capabilitiesByAgent: { ...s.capabilitiesByAgent, [agentId]: capabilities },
  }));
}

/** Statuses on screen, refetched after a reconnect missed their `agent.status`. */
export function resyncAgentStatuses(): void {
  const { statusByAgent, loadAgentStatus } = useAgentsStore.getState();
  for (const agentId of Object.keys(statusByAgent)) {
    void loadAgentStatus(agentId);
  }
}

/** Queues on screen, refetched after a reconnect missed their `agent.queue`. */
export function resyncQueues(): void {
  const { queuedByAgent, loadQueue } = useAgentsStore.getState();
  for (const agentId of Object.keys(queuedByAgent)) {
    loadQueue(agentId).catch(() => {});
  }
}

export function resetAgents(): void {
  useAgentsStore.setState(EMPTY);
}
