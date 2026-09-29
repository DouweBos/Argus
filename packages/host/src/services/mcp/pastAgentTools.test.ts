import type { ChatHistoryEntry } from "../agent/chatHistory";
import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("../agent/chatHistory", () => ({
  loadHistoryIndex: vi.fn(() => []),
}));

const { loadHistoryIndex } = await import("../agent/chatHistory");
const { findPastAgent, registerPastAgentTools } =
  await import("./pastAgentTools");

const REPO = "/repo";

function entry(over: Partial<ChatHistoryEntry>): ChatHistoryEntry {
  return {
    id: "h",
    sessionId: "cli-1",
    title: "t",
    sessionBranch: "feat-a",
    sessionDescription: "",
    messageCount: 3,
    createdAt: 0,
    endedAt: 1000,
    ...over,
  };
}

async function listPast(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerPastAgentTools(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "list_past_agents",
    arguments: { project_path: REPO, ...args },
  });
  await client.close();
  const text = (result.content as { text: string }[])[0].text;

  return text.startsWith("[")
    ? (JSON.parse(text) as Record<string, unknown>[])
    : [];
}

describe("past agent tools", () => {
  beforeEach(() => {
    appState.sessions.clear();
    appState.agents.clear();
    vi.mocked(loadHistoryIndex).mockReturnValue([
      entry({ agentId: "child-1", sessionId: "cli-1", parentAgentId: "orch" }),
      entry({
        agentId: "child-2",
        sessionId: "cli-2",
        parentAgentId: "orch",
        argusSessionId: "s-b",
        sessionBranch: "feat-b",
      }),
      entry({ agentId: "other", sessionId: "cli-3" }),
    ]);
    appState.sessions.set("s-a", {
      id: "s-a",
      repo_root: REPO,
      branch: "feat-a",
    } as Session);
  });

  it("filters by parent and resolves the session by branch", async () => {
    const past = await listPast({ parent_agent_id: "orch" });
    expect(past.map((p) => p.agent_id)).toEqual(["child-1", "child-2"]);
    expect(past[0]).toMatchObject({ session_id: "s-a", session_exists: true });
    expect(past[1]).toMatchObject({ session_id: "s-b", session_exists: false });
  });

  it("filters by session", async () => {
    const past = await listPast({ session: "s-b" });
    expect(past.map((p) => p.agent_id)).toEqual(["child-2"]);
  });

  it("leaves out agents that are still running", async () => {
    appState.agents.set("child-1", {
      agentId: "child-1",
      status: "running",
    } as AgentSession);
    appState.agents.set("child-2", {
      agentId: "child-2",
      status: "stopped",
    } as AgentSession);
    const past = await listPast({ parent_agent_id: "orch" });
    expect(past.map((p) => p.agent_id)).toEqual(["child-2"]);
  });

  it("finds a past agent by agent id or runner session id", () => {
    expect(findPastAgent(REPO, "child-2")?.sessionId).toBe("cli-2");
    expect(findPastAgent(REPO, "cli-3")?.agentId).toBe("other");
    expect(findPastAgent(REPO, "nope")).toBeNull();
  });
});
