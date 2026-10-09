import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import {
  clearQueue,
  dequeueMessage,
  enqueueMessage,
  listQueue,
  promoteQueuedMessage,
  removeQueuedMessage,
  updateQueuedMessage,
} from "./messageQueue";

const broadcasts: { event: string; payload: unknown }[] = [];

vi.mock("../../state", () => ({ appState: { agentQueues: new Map() } }));
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (event: string, payload: unknown) => {
    broadcasts.push({ event, payload });
  },
}));

describe("messageQueue", () => {
  beforeEach(() => {
    appState.agentQueues.clear();
    broadcasts.length = 0;
  });

  it("queues and drains in order", () => {
    enqueueMessage("a1", { text: "first" });
    enqueueMessage("a1", { text: "second" });

    expect(listQueue("a1")).toHaveLength(2);
    expect(dequeueMessage("a1")?.text).toBe("first");
    expect(dequeueMessage("a1")?.text).toBe("second");
    expect(dequeueMessage("a1")).toBeUndefined();
  });

  it("moves a message to the head of the queue", () => {
    enqueueMessage("a1", { text: "first" });
    const second = enqueueMessage("a1", { text: "second" });

    expect(promoteQueuedMessage("a1", second.id)).toBe(true);
    expect(listQueue("a1").map((m) => m.text)).toEqual(["second", "first"]);
    expect(promoteQueuedMessage("a1", "missing")).toBe(false);
  });

  it("keeps each agent's queue separate", () => {
    enqueueMessage("a1", { text: "mine" });
    enqueueMessage("a2", { text: "theirs" });

    expect(listQueue("a1").map((m) => m.text)).toEqual(["mine"]);
    expect(listQueue("a2").map((m) => m.text)).toEqual(["theirs"]);
  });

  it("only stores display text when it differs", () => {
    const same = enqueueMessage("a1", { text: "hi", displayText: "hi" });
    const differs = enqueueMessage("a1", {
      text: "preamble\n\nhi",
      displayText: "hi",
    });

    expect(same.display_text).toBeUndefined();
    expect(differs.display_text).toBe("hi");
  });

  it("removes and edits by id", () => {
    const a = enqueueMessage("a1", { text: "a" });
    const b = enqueueMessage("a1", { text: "b" });

    updateQueuedMessage("a1", b.id, "edited");
    removeQueuedMessage("a1", a.id);

    expect(listQueue("a1").map((m) => m.text)).toEqual(["edited"]);
  });

  it("drops the preamble when a message is edited", () => {
    const m = enqueueMessage("a1", {
      text: "preamble\n\nhi",
      displayText: "hi",
    });
    updateQueuedMessage("a1", m.id, "hello");

    expect(listQueue("a1")[0].display_text).toBeUndefined();
  });

  it("clears a whole queue", () => {
    enqueueMessage("a1", { text: "a" });
    clearQueue("a1");

    expect(listQueue("a1")).toEqual([]);
  });

  it("broadcasts the new queue on every change", () => {
    enqueueMessage("a1", { text: "a" });

    expect(broadcasts.at(-1)?.event).toBe("agent:queue:a1");
    expect(broadcasts.at(-1)?.payload).toHaveLength(1);

    clearQueue("a1");
    expect(broadcasts.at(-1)?.payload).toEqual([]);
  });

  it("refuses to grow past the per-agent cap", () => {
    for (let i = 0; i < 100; i++) {
      enqueueMessage("a1", { text: `m${i}` });
    }

    expect(() => enqueueMessage("a1", { text: "overflow" })).toThrow();
    expect(listQueue("a1")).toHaveLength(100);
  });
});
