import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it, vi } from "vitest";
import { hasOpenMcpCall, trackOpenCalls } from "./openCalls";
import { ArgusTaskStore } from "./taskStore";

function connection() {
  const receive = vi.fn();
  const send = vi.fn(async () => undefined);
  const transport: Transport = {
    start: async () => undefined,
    close: async () => undefined,
    send,
    onmessage: receive,
    onclose: vi.fn(),
  };
  trackOpenCalls("a1", transport);

  return {
    transport,
    receive,
    send,
    call: (id: number) =>
      transport.onmessage?.({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "wait_for_agent" },
      }),
  };
}

describe("open MCP calls", () => {
  it("is open until it's answered", async () => {
    const c = connection();
    c.call(1);
    expect(hasOpenMcpCall("a1")).toBe(true);
    expect(c.receive).toHaveBeenCalled();

    await c.transport.send({ jsonrpc: "2.0", id: 1, result: {} });

    expect(hasOpenMcpCall("a1")).toBe(false);
    expect(c.send).toHaveBeenCalled();
    c.transport.onclose?.();
  });

  it("isn't closed by a progress notification", async () => {
    const c = connection();
    c.call(1);

    await c.transport.send({
      jsonrpc: "2.0",
      method: "notifications/progress",
    });

    expect(hasOpenMcpCall("a1")).toBe(true);
    c.transport.onclose?.();
  });

  it("ends when the client cancels", () => {
    const c = connection();
    c.call(1);

    c.transport.onmessage?.({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    });

    expect(hasOpenMcpCall("a1")).toBe(false);
    c.transport.onclose?.();
  });

  it("ends with the connection", () => {
    const c = connection();
    c.call(1);

    c.transport.onclose?.();

    expect(hasOpenMcpCall("a1")).toBe(false);
  });

  it("counts a task nobody is polling", async () => {
    const store = new ArgusTaskStore();
    const transport: Transport = {
      start: async () => undefined,
      close: async () => undefined,
      send: async () => undefined,
    };
    trackOpenCalls("a2", transport, () => store.hasWorking());
    const task = await store.createTask({}, 1, {
      method: "tools/call",
      params: { task: {} },
    });
    expect(hasOpenMcpCall("a2")).toBe(true);

    await store.storeTaskResult(task.taskId, "completed", {});

    expect(hasOpenMcpCall("a2")).toBe(false);
    transport.onclose?.();
    store.clear();
  });
});
