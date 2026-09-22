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
    title: input.title,
  })),
  supersedeProposals: vi.fn(() => [
    { id: "p0", title: "Old one", status: "superseded", reason: "Re-proposed" },
  ]),
  withdrawProposal: vi.fn((id: string, reason: string) => ({
    id,
    status: "withdrawn",
    cleared_reason: reason,
  })),
  getProposal: vi.fn(() => null),
  listProposals: vi.fn(() => []),
}));

const { listAutomationRuns } = await import("../automation/manager");
const {
  createProposal,
  getProposal,
  listProposals,
  supersedeProposals,
  withdrawProposal,
} = await import("../automation/proposals/manager");
const { isAutomationHostAgent } = await import("./automationCaller");
const { registerAutomationTools } = await import("./automationTools");

const mockListAutomationRuns = vi.mocked(listAutomationRuns);
const mockCreateProposal = vi.mocked(createProposal);
const mockGetProposal = vi.mocked(getProposal);
const mockListProposals = vi.mocked(listProposals);
const mockSupersede = vi.mocked(supersedeProposals);
const mockWithdraw = vi.mocked(withdrawProposal);

/** A stored proposal, only as much of one as the tools read. */
function stored(patch: Record<string, unknown> = {}) {
  return {
    id: "p-old",
    run_id: "run-0",
    automation_id: "auto-1",
    title: "Get PR #6478 reviewed",
    summary: "It has been sitting at REVIEW_REQUIRED.",
    rationale: "Nobody is looking at it.",
    confidence: 0.7,
    recommended_action: "review",
    source_ref: null,
    repo_root: "/src/app",
    status: "pending",
    created_at: Date.now() - 90_000_000,
    ...patch,
  } as never;
}

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
    mockListProposals.mockReturnValue([]);
    mockGetProposal.mockReturnValue(null);
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

  describe("supersedes", () => {
    it("clears the proposals the new one replaces and says which", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      const client = await connect("a-host");

      const result = await client.callTool({
        name: "emit_proposal",
        arguments: { ...ARGS, supersedes: ["p0"] },
      });

      expect(mockSupersede).toHaveBeenCalledWith(
        ["p0"],
        expect.objectContaining({ id: "p1" }),
      );
      const text = (result.content as { text: string }[])[0].text;
      expect(JSON.parse(text).superseded).toHaveLength(1);
      await client.close();
    });

    it("leaves the inbox alone when nothing was named", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      const client = await connect("a-host");

      await client.callTool({ name: "emit_proposal", arguments: ARGS });

      expect(mockSupersede).not.toHaveBeenCalled();
      await client.close();
    });
  });

  describe("list_open_proposals", () => {
    it("reads only this automation's undecided proposals", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      mockListProposals.mockReturnValue([stored()]);
      const client = await connect("a-host");

      const result = await client.callTool({
        name: "list_open_proposals",
        arguments: {},
      });

      expect(mockListProposals).toHaveBeenCalledWith({
        automationId: "auto-1",
        status: "pending",
      });
      const payload = JSON.parse(
        (result.content as { text: string }[])[0].text,
      );
      expect(payload.count).toBe(1);
      expect(payload.proposals[0]).toMatchObject({
        proposal_id: "p-old",
        from_this_run: false,
      });
      await client.close();
    });

    it("is not registered for an ordinary agent", async () => {
      registerAgent("a-worktree", { id: "s1", kind: "worktree" });
      const client = await connect("a-worktree");

      await expect(
        client.callTool({ name: "list_open_proposals", arguments: {} }),
      ).rejects.toThrow();
      await client.close();
    });
  });

  describe("withdraw_proposal", () => {
    it("withdraws its own automation's proposal with the reason", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      mockGetProposal.mockReturnValue(stored());
      const client = await connect("a-host");

      const result = await client.callTool({
        name: "withdraw_proposal",
        arguments: { proposal_id: "p-old", reason: "PR #6478 merged Tuesday" },
      });

      expect(result.isError).toBeFalsy();
      expect(mockWithdraw).toHaveBeenCalledWith(
        "p-old",
        "PR #6478 merged Tuesday",
      );
      await client.close();
    });

    it("refuses a proposal belonging to another automation", async () => {
      registerAgent("a-host", { id: "s2", kind: "automation_host" });
      registerRun("s2");
      mockGetProposal.mockReturnValue(stored({ automation_id: "auto-2" }));
      const client = await connect("a-host");

      const result = await client.callTool({
        name: "withdraw_proposal",
        arguments: { proposal_id: "p-old", reason: "not mine" },
      });

      expect(result.isError).toBe(true);
      expect(mockWithdraw).not.toHaveBeenCalled();
      await client.close();
    });
  });
});
