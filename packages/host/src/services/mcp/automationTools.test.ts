/**
 * The gate is caller identity, not a prompt: `emit_proposal` is not on an
 * ordinary agent's tool list at all, and an automation host's proposals land
 * pending no matter what the agent recommends.
 */

import type { AgentSession } from "../agent/models";
import type { AutomationRun } from "../automation/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("../automation/manager", () => ({
  listAutomationRuns: vi.fn(() => []),
  // No automation behind the run, so the gate refuses and the proposal waits.
  getAutomation: vi.fn(() => null),
  updateRun: vi.fn(),
}));

vi.mock("../automation/proposals/manager", () => ({
  createProposal: vi.fn((input: Record<string, unknown>) => ({
    ...input,
    id: "p1",
    status: "pending",
  })),
}));

const { listAutomationRuns } = await import("../automation/manager");
const { createProposal } = await import("../automation/proposals/manager");
const { isAutomationHostAgent, registerAutomationTools } =
  await import("./automationTools");

const mockListAutomationRuns = vi.mocked(listAutomationRuns);
const mockCreateProposal = vi.mocked(createProposal);

function registerAgent(agentId: string, session: Partial<Session>): void {
  const full: Session = {
    id: "s1",
    kind: "worktree",
    branch: "feat/x",
    display_name: "x",
    description: "",
    path: "/tmp/x",
    repo_root: "/src/app",
    status: "ready",
    env_index: null,
    base_branch: "main",
    ...session,
  };
  appState.sessions.set(full.id, full);
  appState.agents.set(agentId, {
    agentId,
    sessionId: full.id,
  } as AgentSession);
}

function registerRun(hostSessionId: string): void {
  mockListAutomationRuns.mockReturnValue([
    {
      id: "run-1",
      automation_id: "auto-1",
      host_session_id: hostSessionId,
    } as AutomationRun,
  ]);
}

async function connect(callerAgentId: string | null) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerAutomationTools(server, callerAgentId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

const ARGS = {
  title: "Fix the null crash",
  summary: "It crashes on an empty list.",
  confidence: 0.9,
  rationale: "Two people are blocked.",
  recommended_action: "start_session",
  repo_root: "/src/app",
};

describe("automation MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.sessions.clear();
    appState.agents.clear();
    mockListAutomationRuns.mockReturnValue([]);
  });

  describe("isAutomationHostAgent", () => {
    it("is false for an unknown caller, a worktree agent, or a host with no run", () => {
      expect(isAutomationHostAgent(null)).toBe(false);

      registerAgent("a-worktree", { id: "s1", kind: "worktree" });
      expect(isAutomationHostAgent("a-worktree")).toBe(false);

      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      expect(isAutomationHostAgent("a-host")).toBe(false);
    });

    it("is true for an agent in the host session of a live run", () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      expect(isAutomationHostAgent("a-host")).toBe(true);
    });
  });

  describe("emit_proposal", () => {
    it("is not registered for an ordinary agent", async () => {
      registerAgent("a-worktree", { id: "s1", kind: "worktree" });
      const client = await connect("a-worktree");

      // Nothing was registered at all, so the server has no tools capability.
      await expect(
        client.callTool({ name: "emit_proposal", arguments: ARGS }),
      ).rejects.toThrow();

      expect(mockCreateProposal).not.toHaveBeenCalled();
      await client.close();
    });

    it("records a pending proposal against the caller's run", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      const client = await connect("a-host");

      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("emit_proposal");

      const result = await client.callTool({
        name: "emit_proposal",
        arguments: ARGS,
      });
      expect(result.isError).toBeFalsy();
      expect(mockCreateProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          run_id: "run-1",
          automation_id: "auto-1",
          title: "Fix the null crash",
          repo_root: "/src/app",
          source_ref: null,
        }),
      );
      await client.close();
    });

    it("errors when the run behind the caller disappeared mid-run", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      const client = await connect("a-host");

      mockListAutomationRuns.mockReturnValue([]);
      const result = await client.callTool({
        name: "emit_proposal",
        arguments: ARGS,
      });
      expect(result.isError).toBe(true);
      expect(mockCreateProposal).not.toHaveBeenCalled();
      await client.close();
    });
  });
});
