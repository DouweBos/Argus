import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.stubEnv(
  "ARGUS_HOME",
  fs.mkdtempSync(path.join(os.tmpdir(), "argus-mcp-bridge-")),
);

const { getMcpAuthToken, getMcpPort, startMcpServer, stopMcpServer } =
  await import("./server");
const { mcpSessionCount } = await import("./sessions");
const { runStdioBridge } = await import("./stdioBridge");

interface Reply {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

function bridge(headers: Record<string, string>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies = new Map<number, (r: Reply) => void>();
  let buffer = "";
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buffer.slice(0, nl)) as Reply;
      buffer = buffer.slice(nl + 1);
      if (typeof msg.id === "number") {
        replies.get(msg.id)?.(msg);
      }
    }
  });
  const done = runStdioBridge({
    url: `http://127.0.0.1:${getMcpPort()}/mcp`,
    headers,
    input,
    output,
  });
  let next = 1;
  const call = (method: string, params: unknown = {}): Promise<Reply> => {
    const id = next++;
    const reply = new Promise<Reply>((resolve) => replies.set(id, resolve));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);

    return reply;
  };
  const notify = (method: string): void => {
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  };

  return { call, notify, done, close: () => input.end() };
}

const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "1" },
};

describe("stdio MCP bridge", () => {
  beforeAll(async () => {
    await startMcpServer();
  });

  afterAll(() => {
    stopMcpServer();
  });

  it("carries a session from initialize through tool calls, then ends it", async () => {
    const b = bridge({ authorization: `Bearer ${getMcpAuthToken()}` });
    // Sent back to back: the list must wait for initialize's session id.
    const init = b.call("initialize", INIT);
    b.notify("notifications/initialized");
    const list = b.call("tools/list");

    expect((await init).result).toMatchObject({
      protocolVersion: "2025-06-18",
    });
    const tools = ((await list).result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("watch_pull_request");
    expect(mcpSessionCount()).toBe(1);

    b.close();
    await b.done;
    expect(mcpSessionCount()).toBe(0);
  });

  it("answers a request the server refuses with a JSON-RPC error", async () => {
    const b = bridge({ authorization: "Bearer wrong" });
    const init = await b.call("initialize", INIT);

    expect(init.error?.message).toMatch(/401/);
    b.close();
    await b.done;
  });
});
