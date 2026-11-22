import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.stubEnv(
  "ARGUS_HOME",
  fs.mkdtempSync(path.join(os.tmpdir(), "argus-mcp-sessions-")),
);

const { getMcpAuthToken, getMcpPort, startMcpServer, stopMcpServer } =
  await import("./server");
const { closeMcpSessionsForSpawn, mcpSessionCount, SPAWN_ID_HEADER } =
  await import("./sessions");
const { hasOpenMcpCall } = await import("./openCalls");
const { appState } = await import("../../state");

async function post(
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  const res = await fetch(`http://127.0.0.1:${getMcpPort()}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getMcpAuthToken()}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  await res.text();

  return res;
}

async function open(
  spawnId: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    },
    { [SPAWN_ID_HEADER]: spawnId, ...headers },
  );

  return res.headers.get("mcp-session-id")!;
}

describe("mcp sessions", () => {
  beforeAll(async () => {
    await startMcpServer();
  });

  afterAll(() => {
    stopMcpServer();
  });

  it("closes a CLI's sessions when its process exits, and only its", async () => {
    const gone = await open("spawn-a");
    await open("spawn-a");
    await open("spawn-b");
    expect(mcpSessionCount()).toBe(3);

    closeMcpSessionsForSpawn("spawn-a");

    expect(mcpSessionCount()).toBe(1);
    const res = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { "mcp-session-id": gone },
    );
    expect(res.ok).toBe(false);

    closeMcpSessionsForSpawn("spawn-b");
    expect(mcpSessionCount()).toBe(0);
  });

  it("knows which agent has a call open over a real connection", async () => {
    const turnWaiters: ((status: "idle") => void)[] = [];
    appState.agents.set("child", {
      agentId: "child",
      status: "running",
      turnsCompleted: 0,
      resultSummary: null,
      exitWaiters: [],
      turnWaiters,
    } as never);
    const session = await open("spawn-c", { "x-argus-agent-id": "parent" });
    expect(hasOpenMcpCall("parent")).toBe(false);

    const call = post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "wait_for_agent", arguments: { agent_id: "child" } },
      },
      { "mcp-session-id": session },
    );
    await vi.waitFor(() => expect(turnWaiters).toHaveLength(1));
    expect(hasOpenMcpCall("parent")).toBe(true);

    turnWaiters[0]!("idle");
    await call;

    expect(hasOpenMcpCall("parent")).toBe(false);
    closeMcpSessionsForSpawn("spawn-c");
    appState.agents.clear();
  });
});
