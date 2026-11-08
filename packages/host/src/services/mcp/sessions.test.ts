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

async function open(spawnId: string): Promise<string> {
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
    { [SPAWN_ID_HEADER]: spawnId },
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
});
