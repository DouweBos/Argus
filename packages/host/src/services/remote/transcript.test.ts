import type { AgentTranscriptDelta } from "@argus/remote-protocol";
import { EventPayloads } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { toRemoteMessage, toRemoteTranscriptDelta } from "./transcript";

const delta: AgentTranscriptDelta = {
  agentId: "a1",
  epoch: "e1",
  revision: 3,
  total: 3,
  ops: [
    {
      op: "update",
      index: 0,
      message: {
        id: "m0",
        role: "assistant",
        textBlocks: ["hi"],
        toolCalls: [
          {
            id: "t1",
            name: "Read",
            input: {},
            result: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "AAAA",
                },
              },
            ],
          },
        ],
        timestamp: 1,
      },
    },
    {
      op: "append",
      index: 1,
      // Thinking-only bookkeeping: hidden from viewers.
      message: {
        id: "m1",
        role: "assistant",
        textBlocks: [""],
        toolCalls: [],
        timestamp: 2,
      },
    },
    { op: "remove", index: 2, id: "m2" },
  ],
};

describe("toRemoteTranscriptDelta", () => {
  it("maps upserts to remote messages with lazy image refs", () => {
    const out = toRemoteTranscriptDelta(delta, {
      title: "Fix it",
      todos: null,
      pendingToolName: null,
    });

    expect(EventPayloads["agent.transcript"].safeParse(out).success).toBe(true);
    expect(out.messages.map((m) => m.id)).toEqual(["m0"]);
    expect(out.messages[0]?.tool_calls[0]?.result_blocks).toEqual([
      { type: "image", image_id: "m0:t1:0", media_type: "image/png" },
    ]);
    expect(out.removed_ids).toEqual(["m1", "m2"]);
    expect(out.title).toBe("Fix it");
    expect(out.model).toBeNull();
  });

  it("builds each delta once for every connection", () => {
    expect(toRemoteTranscriptDelta(delta, {})).toBe(
      toRemoteTranscriptDelta(delta, {}),
    );
  });
});

describe("toRemoteMessage", () => {
  it("forwards a recognized command", () => {
    const out = toRemoteMessage({
      id: "m1",
      role: "user",
      textBlocks: ["/implement-ticket ENG-1"],
      command: {
        name: "implement-ticket",
        kind: "argus",
        argument: "ENG-1",
        prompt: "# Implement ENG-1",
      },
    });
    expect(out.command).toEqual({
      name: "implement-ticket",
      kind: "argus",
      argument: "ENG-1",
      prompt: "# Implement ENG-1",
    });
    expect(
      toRemoteMessage({ id: "m2", role: "user", textBlocks: ["hi"] }),
    ).not.toHaveProperty("command");
  });

  it("forwards a background call's progress", () => {
    const out = toRemoteMessage({
      id: "m",
      role: "assistant",
      toolCalls: [
        {
          id: "a",
          name: "Agent",
          result: "Async agent launched",
          background: { status: "completed", startedAt: 5, durationMs: 60_000 },
        },
      ],
    });
    expect(out.tool_calls[0]?.background).toEqual({
      status: "completed",
      started_at: 5,
      duration_ms: 60_000,
    });
  });
});
