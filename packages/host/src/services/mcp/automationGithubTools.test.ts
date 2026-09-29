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

vi.mock("../github/readOnly", () => ({
  githubGet: vi.fn(async () => "ok"),
  searchGithubArtifact: vi.fn(async () => "logs/a.log:1: hit"),
}));

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { listAutomationRuns } = await import("../automation/manager");
const { githubGet, searchGithubArtifact } = await import("../github/readOnly");
const { capture } = await import("../telemetry/telemetry");
const { registerAutomationGithubTools } =
  await import("./automationGithubTools");

function registerHost(agentId: string, sessionId: string): void {
  appState.sessions.set(sessionId, {
    id: sessionId,
    kind: "automation_host",
  } as Session);
  appState.agents.set(agentId, { agentId, sessionId } as AgentSession);
  vi.mocked(listAutomationRuns).mockReturnValue([
    {
      id: "run-1",
      automation_id: "auto-1",
      host_session_id: sessionId,
    } as AutomationRun,
  ]);
}

async function connect(callerAgentId: string | null) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerAutomationGithubTools(server, callerAgentId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

describe("automation GitHub tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.sessions.clear();
    appState.agents.clear();
    vi.mocked(listAutomationRuns).mockReturnValue([]);
  });

  it("refuses a caller that isn't an automation run", async () => {
    const client = await connect("stranger");

    const result = await client.callTool({
      name: "github_get",
      arguments: { path: "repos/o/r" },
    });

    expect(result.isError).toBe(true);
    expect(githubGet).not.toHaveBeenCalled();
    await client.close();
  });

  it("passes a run's GET through with the default line cap", async () => {
    registerHost("a-host", "s-host");
    const client = await connect("a-host");

    const result = await client.callTool({
      name: "github_get",
      arguments: { path: "repos/o/r/actions/jobs/1/logs", pattern: "429" },
    });

    expect(result.isError).toBeFalsy();
    expect(githubGet).toHaveBeenCalledWith({
      path: "repos/o/r/actions/jobs/1/logs",
      jq: undefined,
      paginate: undefined,
      pattern: "429",
      maxLines: 200,
    });
    expect(capture).toHaveBeenCalledWith("automation_github_read", {
      tool: "get",
      success: true,
    });
    await client.close();
  });

  it("searches an artifact for a run", async () => {
    registerHost("a-host", "s-host");
    const client = await connect("a-host");

    const result = await client.callTool({
      name: "search_github_artifact",
      arguments: {
        repo: "o/r",
        run_id: "1",
        artifact: "logs",
        pattern: "429",
        max_lines: 5,
      },
    });

    expect(result.content).toEqual([
      { type: "text", text: "logs/a.log:1: hit" },
    ]);
    expect(searchGithubArtifact).toHaveBeenCalledWith({
      repo: "o/r",
      runId: "1",
      artifact: "logs",
      pattern: "429",
      maxLines: 5,
    });
    await client.close();
  });

  it("returns a gh failure as a tool error and counts it", async () => {
    registerHost("a-host", "s-host");
    vi.mocked(githubGet).mockRejectedValueOnce("HTTP 404: Not Found");
    const client = await connect("a-host");

    const result = await client.callTool({
      name: "github_get",
      arguments: { path: "repos/o/missing" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "HTTP 404: Not Found" },
    ]);
    expect(capture).toHaveBeenCalledWith("automation_github_read", {
      tool: "get",
      success: false,
    });
    await client.close();
  });
});
