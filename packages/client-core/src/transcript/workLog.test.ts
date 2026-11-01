import type { RemoteMessage } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  type WorkLog,
  transcriptItems,
  workLogCallCount,
  workLogLabel,
} from "./workLog";

// Same cases as ArgusCore's WorkLogTests and ArgusUI's WorkLogLabelTests.
const user = (id: string, at?: number): RemoteMessage => ({
  id,
  role: "user",
  text_blocks: ["do it"],
  tool_calls: [],
  ...(at === undefined ? {} : { timestamp: at }),
});

const reply = (id: string, at?: number): RemoteMessage => ({
  id,
  role: "assistant",
  text_blocks: ["done"],
  tool_calls: [],
  ...(at === undefined ? {} : { timestamp: at }),
});

function tool(
  id: string,
  opts: {
    at?: number;
    background?: "completed" | "running";
    ranFor?: number;
    name?: string;
  } = {},
): RemoteMessage {
  return {
    id,
    role: "assistant",
    text_blocks: [],
    tool_calls: [
      {
        id: `c-${id}`,
        name: opts.name ?? "Agent",
        input: {},
        result_blocks: [],
        status: "done",
        ...(opts.background
          ? {
              background: {
                status: opts.background,
                started_at: 1000,
                ...(opts.ranFor === undefined
                  ? {}
                  : { duration_ms: opts.ranFor }),
              },
            }
          : {}),
      },
    ],
    ...(opts.at === undefined ? {} : { timestamp: opts.at }),
  };
}

function logs(messages: RemoteMessage[]): WorkLog[] {
  return transcriptItems(messages).flatMap((item) =>
    item.kind === "work" ? [item.log] : [],
  );
}

describe("work logs", () => {
  it("spans from the message before it to the reply after", () => {
    const [log] = logs([
      user("u", 1000),
      tool("a", { at: 2000 }),
      tool("b", { at: 3000 }),
      reply("r", 9000),
    ]);
    expect(log.id).toBe("group-a");
    expect(log.started).toBe(1000);
    expect(log.ended).toBe(9000);
    expect(log.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("has no end while it's the newest work", () => {
    expect(
      logs([user("u", 1000), tool("a", { at: 2000 })])[0].ended,
    ).toBeNull();
  });

  it("ends at its own last message when the next user message cuts it off", () => {
    expect(
      logs([
        user("u", 1000),
        tool("a", { at: 2000 }),
        tool("b", { at: 3000 }),
        user("v", 8000),
      ])[0].ended,
    ).toBe(3000);
  });

  it("has no start as the first thing in a chat", () => {
    expect(
      logs([tool("a", { at: 2000 }), reply("r", 3000)])[0].started,
    ).toBeNull();
  });

  it("counts background work in its own turn only", () => {
    expect(
      logs([
        user("u"),
        tool("a", { background: "running" }),
        reply("r"),
        user("v"),
        tool("b", { background: "running" }),
        tool("c", { background: "running" }),
      ]).map((l) => l.stillRunning),
    ).toEqual(["1 agent still running", "2 agents still running"]);
    expect(
      logs([user("u"), tool("a", { background: "completed" }), reply("r")])[0]
        .stillRunning,
    ).toBeNull();
  });

  it("runs until its last background agent finished", () => {
    expect(
      logs([
        user("u", 500),
        tool("a", { at: 1000, background: "completed", ranFor: 600_000 }),
        reply("r", 2000),
      ])[0].ended,
    ).toBe(601_000);
    expect(
      logs([
        user("u", 500),
        tool("a", { at: 1000, background: "completed", ranFor: 10 }),
        reply("r", 2000),
      ])[0].ended,
    ).toBe(2000);
  });

  it("has no work log when runs fold", () => {
    const items = transcriptItems(
      [tool("a", { name: "Read" }), tool("b", { name: "Read" })],
      "runs",
    );
    expect(items.map((i) => i.kind)).toEqual(["run"]);
  });
});

describe("work log label", () => {
  const read = (id: string, at?: number) => tool(id, { at, name: "Read" });
  const now = 1_000_000;
  const log = (partial: Partial<WorkLog>): WorkLog => ({
    id: "l",
    messages: [],
    started: null,
    ended: null,
    stillRunning: null,
    ...partial,
  });

  it("reads finished work as its span", () => {
    expect(
      workLogLabel(
        log({ messages: [read("a", 10_000)], started: 1000, ended: 330_000 }),
        false,
        now,
      ),
    ).toBe("Worked for 5m 29s");
  });

  it("counts work still going up from the turn's start", () => {
    expect(
      workLogLabel(
        log({ messages: [read("a", 900_000)], started: 988_000 }),
        true,
        now,
      ),
    ).toBe("Working for 12s");
    expect(workLogLabel(log({}), true, now)).toBe("Working…");
  });

  it("falls back to its own messages, then the call count", () => {
    expect(
      workLogLabel(
        log({ messages: [read("a", 1000), read("b", 4000)] }),
        false,
        now,
      ),
    ).toBe("Worked for 3s");
    expect(workLogLabel(log({ messages: [read("a")] }), false, now)).toBe(
      "1 tool call",
    );
    expect(
      workLogCallCount(log({ messages: [read("a", 1), read("b", 1)] })),
    ).toBe("2 tool calls");
  });

  it("appends background work still running", () => {
    expect(
      workLogLabel(
        log({
          messages: [read("a")],
          started: 1000,
          ended: 3000,
          stillRunning: "1 agent still running",
        }),
        false,
        now,
      ),
    ).toBe("Worked for 2s · 1 agent still running");
  });
});
