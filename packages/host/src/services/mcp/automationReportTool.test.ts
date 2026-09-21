/**
 * `emit_report` is the only way a run publishes blocks, so the closed union is
 * the boundary: a block the model invented, or a table row with the wrong
 * number of cells, has to come back as a tool error rather than reach the
 * renderer.
 */

import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("../automation/manager", () => ({
  listAutomationRuns: vi.fn(() => [
    { id: "run-1", automation_id: "auto-1", host_session_id: "s2" },
  ]),
  updateRun: vi.fn(),
}));

const { updateRun } = await import("../automation/manager");
const { registerAutomationReportTool } = await import("./automationReportTool");

const mockUpdateRun = vi.mocked(updateRun);

async function connect() {
  const session = {
    id: "s2",
    kind: "automation_host",
    branch: "automation",
    description: "",
    path: "/tmp/run",
    repo_root: "/tmp/run",
    status: "ready",
  } as Session;
  appState.sessions.set(session.id, session);
  appState.agents.set("a-host", {
    agentId: "a-host",
    sessionId: session.id,
  } as AgentSession);

  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerAutomationReportTool(server, "a-host");
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

function text(result: unknown): string {
  const content = (result as { content: { text: string }[] }).content;

  return content.map((c) => c.text).join("\n");
}

describe("emit_report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.sessions.clear();
    appState.agents.clear();
  });

  it("stores valid blocks on the caller's run", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "emit_report",
      arguments: {
        blocks: [
          { type: "heading", text: "Morning triage" },
          { type: "stats", items: [{ label: "Open", value: "7", delta: -2 }] },
          {
            type: "series",
            kind: "bar",
            labels: ["Mon", "Tue"],
            values: [3, 5],
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(mockUpdateRun).toHaveBeenCalledWith("run-1", {
      report_blocks: expect.arrayContaining([
        expect.objectContaining({ type: "heading" }),
      ]) as unknown,
    });
    await client.close();
  });

  it("rejects a block type that is not in the union", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "emit_report",
      arguments: { blocks: [{ type: "iframe", src: "https://example.com" }] },
    });

    expect(result.isError).toBe(true);
    expect(mockUpdateRun).not.toHaveBeenCalled();
    await client.close();
  });

  it("rejects a table row with the wrong number of cells", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "emit_report",
      arguments: {
        blocks: [
          {
            type: "table",
            columns: ["PR", "CI"],
            rows: [["#1", "red"], ["#2"]],
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("one cell per column");
    expect(mockUpdateRun).not.toHaveBeenCalled();
    await client.close();
  });

  it("rejects a series whose labels and values disagree", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "emit_report",
      arguments: {
        blocks: [
          { type: "series", kind: "line", labels: ["a", "b"], values: [1] },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(mockUpdateRun).not.toHaveBeenCalled();
    await client.close();
  });
});
