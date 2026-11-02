/**
 * What an agent reports beyond its chat: the MCP servers its CLI loaded, and
 * the other Claude accounts a chat stalled on a spent limit could move to.
 * Mirrors `HostStore+Agents` (MCP) and `HostStore+LimitHandoff`; the host
 * captures the handoff's telemetry.
 */

import { create } from "zustand";
import { describeError } from "@argus/client-core";
import type {
  LimitHandoffAccount,
  RemoteMcpServerStatus,
} from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

export interface AgentMcp {
  /** Null when the agent's CLI can't report MCP status. */
  servers: RemoteMcpServerStatus[] | null;
  accountId: string | null;
}

interface AgentExtrasState {
  mcpByAgent: Record<string, AgentMcp>;
  mcpErrorByAgent: Record<string, string | null>;
  handoffByAgent: Record<string, LimitHandoffAccount[]>;

  loadMcp: (agentId: string) => Promise<void>;
  loadHandoff: (agentId: string) => Promise<void>;
  clearHandoff: (agentId: string) => void;
  /** Move the agent onto `accountId` and continue its turn. Throws the host's reason. */
  handoff: (agentId: string, accountId: string) => Promise<void>;
}

const EMPTY = {
  mcpByAgent: {},
  mcpErrorByAgent: {},
  handoffByAgent: {},
} satisfies Partial<AgentExtrasState>;

function connected() {
  const t = currentTransport();
  if (!t) {
    throw new Error("not connected");
  }

  return t;
}

export const useAgentExtrasStore = create<AgentExtrasState>()((set) => ({
  ...EMPTY,

  loadMcp: async (agentId) => {
    try {
      const result = await request(connected(), "agents.mcp_status", {
        agent_id: agentId,
      });
      set((s) => ({
        mcpByAgent: {
          ...s.mcpByAgent,
          [agentId]: {
            servers: result.servers,
            accountId: result.account_id ?? null,
          },
        },
        mcpErrorByAgent: { ...s.mcpErrorByAgent, [agentId]: null },
      }));
    } catch (err) {
      set((s) => ({
        mcpErrorByAgent: { ...s.mcpErrorByAgent, [agentId]: describeError(err) },
      }));
    }
  },

  loadHandoff: async (agentId) => {
    try {
      const { accounts } = await request(connected(), "agents.limit_handoff", {
        agent_id: agentId,
      });
      set((s) => ({
        handoffByAgent: { ...s.handoffByAgent, [agentId]: accounts },
      }));
    } catch {
      // No card is the right answer when the computer can't say.
    }
  },

  clearHandoff: (agentId) => {
    set((s) => ({ handoffByAgent: { ...s.handoffByAgent, [agentId]: [] } }));
  },

  handoff: async (agentId, accountId) => {
    await request(connected(), "agents.handoff_to_account", {
      agent_id: agentId,
      account_id: accountId,
    });
    set((s) => ({ handoffByAgent: { ...s.handoffByAgent, [agentId]: [] } }));
  },
}));

export function resetAgentExtras(): void {
  useAgentExtrasStore.setState(EMPTY);
}
