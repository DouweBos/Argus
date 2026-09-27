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
}));

vi.mock("../automation/memory/store", () => ({
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

const { listAutomationRuns } = await import("../automation/manager");
const { deleteMemory, saveMemory } = await import("../automation/memory/store");
const { registerAutomationMemoryTools } =
  await import("./automationMemoryTools");

const ARGS = {
  name: "merge-flow",
  description: "Where merges live",
  type: "project",
  body: "merge.ts",
};

function registerHost(agentId: string, sessionId: string): void {
  appState.sessions.set(sessionId, {
    id: sessionId,
    kind: "automation_host",
  } as Session);
  appState.agents.set(agentId, { agentId, sessionId } as AgentSession);
}

async function connect(callerAgentId: string | null) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerAutomationMemoryTools(server, callerAgentId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

describe("automation memory tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.sessions.clear();
    appState.agents.clear();
    vi.mocked(listAutomationRuns).mockReturnValue([]);
  });

  it("refuses a caller that isn't an automation run", async () => {
    const client = await connect("stranger");

    const result = await client.callTool({
      name: "save_memory",
      arguments: ARGS,
    });
    expect(result.isError).toBe(true);
    expect(saveMemory).not.toHaveBeenCalled();
    await client.close();
  });

  it("writes to the caller's own automation", async () => {
    registerHost("a-host", "s-host");
    vi.mocked(listAutomationRuns).mockReturnValue([
      {
        id: "run-1",
        automation_id: "auto-1",
        host_session_id: "s-host",
      } as AutomationRun,
    ]);
    const client = await connect("a-host");

    const saved = await client.callTool({
      name: "save_memory",
      arguments: ARGS,
    });
    expect(saved.isError).toBeFalsy();
    expect(saveMemory).toHaveBeenCalledWith("auto-1", ARGS);

    await client.callTool({
      name: "delete_memory",
      arguments: { name: "merge-flow" },
    });
    expect(deleteMemory).toHaveBeenCalledWith("auto-1", "merge-flow");
    await client.close();
  });

  it("returns a store rejection as a tool error", async () => {
    registerHost("a-host", "s-host");
    vi.mocked(listAutomationRuns).mockReturnValue([
      {
        id: "run-1",
        automation_id: "auto-1",
        host_session_id: "s-host",
      } as AutomationRun,
    ]);
    vi.mocked(saveMemory).mockImplementation(() => {
      throw "Memory name must be a lowercase kebab-case slug";
    });
    const client = await connect("a-host");

    const result = await client.callTool({
      name: "save_memory",
      arguments: ARGS,
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
