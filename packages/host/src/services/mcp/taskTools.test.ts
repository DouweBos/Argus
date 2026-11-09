import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ArgusTaskStore } from "./taskStore";
import { registerTaskTool } from "./taskTools";

const capture = vi.hoisted(() => vi.fn());
vi.mock("../telemetry/telemetry", () => ({ capture }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const text = (t: string): CallToolResult => ({
  content: [{ type: "text", text: t }],
});

async function connect(run: (args: { id: string }) => Promise<CallToolResult>) {
  const store = new ArgusTaskStore();
  const server = new McpServer(
    { name: "test", version: "1" },
    {
      capabilities: {
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
      taskStore: store,
    },
  );
  registerTaskTool(server, store, {
    name: "wait_for_agent",
    description: "wait",
    shape: { id: z.string() },
    run,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "c", version: "1" });
  await client.connect(clientTransport);
  cleanups.push(() => client.close());

  return client;
}

const cleanups: (() => Promise<void>)[] = [];

describe("registerTaskTool", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((c) => c()));
    capture.mockClear();
  });

  it("advertises optional task support", async () => {
    const client = await connect(async () => text("ok"));
    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ execution: { taskSupport: "optional" } }],
    });
  });

  it("blocks plain calls until the work settles", async () => {
    const gate = deferred<CallToolResult>();
    const client = await connect(() => gate.promise);
    const call = client.callTool({
      name: "wait_for_agent",
      arguments: { id: "a" },
    });
    setTimeout(() => gate.resolve(text("done a")), 20);

    await expect(call).resolves.toMatchObject({
      content: [{ text: "done a" }],
    });
    expect(capture).toHaveBeenCalledWith("mcp_task_finished", {
      tool: "wait_for_agent",
      mode: "blocking",
      outcome: "completed",
    });
  });

  it("hands task-aware clients a task, then the result", async () => {
    const gate = deferred<CallToolResult>();
    const client = await connect(() => gate.promise);

    const stream = client.experimental.tasks.callToolStream(
      { name: "wait_for_agent", arguments: { id: "a" } },
      undefined,
      { task: { ttl: 60_000 } },
    );
    const first = await stream.next();
    expect(first.value).toMatchObject({
      type: "taskCreated",
      task: { status: "working" },
    });
    const taskId = (first.value as { task: { taskId: string } }).task.taskId;
    await expect(
      client.experimental.tasks.getTask(taskId),
    ).resolves.toMatchObject({ status: "working" });

    gate.resolve(text("done a"));
    const messages = [];
    for await (const message of stream) {
      messages.push(message);
    }

    expect(messages.at(-1)).toMatchObject({
      type: "result",
      result: { content: [{ text: "done a" }] },
    });
    expect(capture).toHaveBeenCalledWith("mcp_task_finished", {
      tool: "wait_for_agent",
      mode: "task",
      outcome: "completed",
    });
  });

  it("marks error results as failed tasks", async () => {
    const client = await connect(async () => ({
      ...text("No agent found"),
      isError: true,
    }));
    const result = await client.callTool({
      name: "wait_for_agent",
      arguments: { id: "a" },
    });

    expect(result.isError).toBe(true);
    expect(capture).toHaveBeenCalledWith(
      "mcp_task_finished",
      expect.objectContaining({ outcome: "failed" }),
    );
  });

  it("turns a throw into an error result", async () => {
    const client = await connect(() =>
      Promise.reject("Cannot merge: 1 conflicting file(s)"),
    );
    const result = await client.callTool({
      name: "wait_for_agent",
      arguments: { id: "a" },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: "Cannot merge: 1 conflicting file(s)" }],
    });
  });

  it("drops the result of a task the client cancelled", async () => {
    const gate = deferred<CallToolResult>();
    const client = await connect(() => gate.promise);
    const stream = client.experimental.tasks.callToolStream(
      { name: "wait_for_agent", arguments: { id: "a" } },
      undefined,
      { task: { ttl: 60_000 } },
    );
    const first = await stream.next();
    const taskId = (first.value as { task: { taskId: string } }).task.taskId;

    await client.experimental.tasks.cancelTask(taskId);
    gate.resolve(text("too late"));
    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledWith(
        "mcp_task_finished",
        expect.objectContaining({ outcome: "cancelled" }),
      ),
    );
    await expect(
      client.experimental.tasks.getTask(taskId),
    ).resolves.toMatchObject({ status: "cancelled" });
  });
});
