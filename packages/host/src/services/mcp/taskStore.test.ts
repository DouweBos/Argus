import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArgusTaskStore,
  CLIENT_POLL_INTERVAL_MS,
  DEFAULT_RETENTION_MS,
  INTERNAL_POLL_INTERVAL_MS,
} from "./taskStore";

const plain = { method: "tools/call", params: { name: "t" } };
const augmented = {
  method: "tools/call",
  params: { name: "t", task: { ttl: 1_000 } },
};

describe("argusTaskStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls tightly in-process for plain calls, gently for task clients", async () => {
    const store = new ArgusTaskStore();
    const a = await store.createTask({}, 1, plain);
    const b = await store.createTask({ ttl: 1_000 }, 2, augmented);

    expect(a.pollInterval).toBe(INTERNAL_POLL_INTERVAL_MS);
    expect(store.isAugmented(a.taskId)).toBe(false);
    expect(b.pollInterval).toBe(CLIENT_POLL_INTERVAL_MS);
    expect(store.isAugmented(b.taskId)).toBe(true);
  });

  it("keeps a working task past its TTL and expires it once finished", async () => {
    vi.useFakeTimers();
    const store = new ArgusTaskStore();
    const { taskId } = await store.createTask({ ttl: 1_000 }, 1, augmented);

    vi.advanceTimersByTime(10_000);
    await expect(store.getTask(taskId)).resolves.not.toBeNull();

    await store.storeTaskResult(taskId, "completed", { content: [] });
    await expect(store.getTaskResult(taskId)).resolves.toEqual({ content: [] });
    vi.advanceTimersByTime(1_000);
    await expect(store.getTask(taskId)).resolves.toBeNull();
  });

  it("retains finished tasks without a TTL for the default window", async () => {
    vi.useFakeTimers();
    const store = new ArgusTaskStore();
    const { taskId } = await store.createTask({}, 1, plain);
    await store.storeTaskResult(taskId, "failed", { content: [] });

    vi.advanceTimersByTime(DEFAULT_RETENTION_MS - 1);
    await expect(store.getTask(taskId)).resolves.toMatchObject({
      status: "failed",
    });
    vi.advanceTimersByTime(1);
    await expect(store.getTask(taskId)).resolves.toBeNull();
  });

  it("refuses a result for a cancelled task", async () => {
    const store = new ArgusTaskStore();
    const { taskId } = await store.createTask({}, 1, augmented);
    await store.updateTaskStatus(taskId, "cancelled");

    await expect(
      store.storeTaskResult(taskId, "completed", { content: [] }),
    ).rejects.toThrow("cancelled");
  });

  it("scopes tasks to their MCP session", async () => {
    const store = new ArgusTaskStore();
    const { taskId } = await store.createTask({}, 1, augmented, "s1");

    await expect(store.getTask(taskId, "s2")).resolves.toBeNull();
    await expect(store.listTasks(undefined, "s2")).resolves.toEqual({
      tasks: [],
    });
    await expect(store.listTasks(undefined, "s1")).resolves.toMatchObject({
      tasks: [{ taskId }],
    });
  });
});
