/**
 * Single app store: owns the identity, the live Transport, and the
 * monitor-scoped data it fetches. Screens read slices and call actions; the
 * Transport pushes events back in through `onEvent`.
 */

import { create } from "zustand";
import { clearIdentity, loadIdentity, saveIdentity } from "../lib/keystore";
import type { DeviceIdentity } from "../lib/keystore";
import type {
  EventEnvelope,
  RemoteAgentStatus,
  RemotePermissionRequest,
  RemoteProject,
  RemoteSession,
} from "../lib/protocol";
import { Transport, type ConnectionState } from "../lib/transport";

interface AppState {
  identity: DeviceIdentity | null;
  loaded: boolean;
  connection: ConnectionState;
  transport: Transport | null;

  projects: RemoteProject[];
  sessionsByRepo: Record<string, RemoteSession[]>;
  agentsBySession: Record<string, RemoteAgentStatus[]>;
  transcriptByAgent: Record<string, string[]>;
  /** Pending permission prompts keyed by `${agentId}:${toolUseId}`. */
  prompts: Record<string, RemotePermissionRequest>;

  init: () => Promise<void>;
  pairComplete: (identity: DeviceIdentity) => Promise<void>;
  unpair: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  loadSessions: (repoRoot: string) => Promise<void>;
  loadAgents: (sessionId: string) => Promise<void>;
  loadTranscript: (agentId: string) => Promise<void>;
  watchAgent: (agentId: string, on: boolean) => void;
  respond: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
  ) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
  function onEvent(ev: EventEnvelope): void {
    if (ev.event === "permission.request") {
      const p = ev.payload as RemotePermissionRequest;
      set((s) => ({
        prompts: { ...s.prompts, [`${p.agent_id}:${p.tool_use_id}`]: p },
      }));
    } else if (ev.event === "permission.cancel") {
      const p = ev.payload as { agent_id: string; tool_use_id: string };
      set((s) => {
        const next = { ...s.prompts };
        delete next[`${p.agent_id}:${p.tool_use_id}`];

        return { prompts: next };
      });
    } else if (ev.event === "agent.status") {
      const a = ev.payload as RemoteAgentStatus;
      set((s) => ({
        agentsBySession: {
          ...s.agentsBySession,
          [a.session_id]: (s.agentsBySession[a.session_id] ?? []).map((x) =>
            x.agent_id === a.agent_id ? a : x,
          ),
        },
      }));
    } else if (ev.event === "agent.event" && ev.agent_id) {
      const line = JSON.stringify((ev.payload as { event: unknown }).event);
      set((s) => ({
        transcriptByAgent: {
          ...s.transcriptByAgent,
          [ev.agent_id!]: [...(s.transcriptByAgent[ev.agent_id!] ?? []), line],
        },
      }));
    }
  }

  function connect(identity: DeviceIdentity): Transport {
    const transport = new Transport(identity, {
      onState: (connection) => set({ connection }),
      onEvent,
    });
    transport.connect();

    return transport;
  }

  return {
    identity: null,
    loaded: false,
    connection: "offline",
    transport: null,
    projects: [],
    sessionsByRepo: {},
    agentsBySession: {},
    transcriptByAgent: {},
    prompts: {},

    init: async () => {
      const identity = await loadIdentity();
      if (identity) {
        set({ identity, transport: connect(identity), loaded: true });
      } else {
        set({ loaded: true });
      }
    },

    pairComplete: async (identity) => {
      await saveIdentity(identity);
      get().transport?.disconnect();
      set({ identity, transport: connect(identity) });
    },

    unpair: async () => {
      get().transport?.disconnect();
      await clearIdentity();
      set({
        identity: null,
        transport: null,
        connection: "offline",
        projects: [],
        sessionsByRepo: {},
        agentsBySession: {},
      });
    },

    refreshProjects: async () => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { projects } = await t.request<{ projects: RemoteProject[] }>(
        "projects.list",
        {},
      );
      set({ projects });
    },

    loadSessions: async (repoRoot) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { sessions } = await t.request<{ sessions: RemoteSession[] }>(
        "sessions.list",
        { repo_root: repoRoot },
      );
      set((s) => ({
        sessionsByRepo: { ...s.sessionsByRepo, [repoRoot]: sessions },
      }));
    },

    loadAgents: async (sessionId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { agents } = await t.request<{ agents: RemoteAgentStatus[] }>(
        "agents.list",
        { session_id: sessionId },
      );
      set((s) => ({
        agentsBySession: { ...s.agentsBySession, [sessionId]: agents },
      }));
    },

    loadTranscript: async (agentId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { lines } = await t.request<{ lines: string[] }>(
        "agents.transcript",
        { agent_id: agentId, limit: 200 },
      );
      set((s) => ({
        transcriptByAgent: { ...s.transcriptByAgent, [agentId]: lines },
      }));
    },

    watchAgent: (agentId, on) => {
      get().transport?.subscribe(agentId, on);
    },

    respond: async (agentId, toolUseId, decision) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request("permission.respond", {
        agent_id: agentId,
        tool_use_id: toolUseId,
        decision,
      });
      set((s) => {
        const next = { ...s.prompts };
        delete next[`${agentId}:${toolUseId}`];

        return { prompts: next };
      });
    },
  };
});
