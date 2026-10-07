import type { AgentTranscriptDelta } from "@argus/remote-protocol";
import { EventPayloads } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { toRemoteTranscriptDelta } from "./transcript";

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
