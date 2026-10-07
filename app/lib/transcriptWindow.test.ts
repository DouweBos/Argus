import type { ConversationMessage } from "@argus/host/services/agent/conversation/types";
import type { AgentTranscriptPage } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  applyDelta,
  fromPage,
  prependPage,
  trimWindow,
} from "./transcriptWindow";

function msg(i: number, text = `m${i}`): ConversationMessage {
  return {
    id: `m${i}`,
    role: "assistant",
    textBlocks: [text],
    toolCalls: [],
    timestamp: i,
  };
}

function page(
  start: number,
  end: number,
  total = end,
  revision = 4,
): AgentTranscriptPage {
  const messages = [];
  for (let i = start; i < end; i++) {
    messages.push(msg(i));
  }

  return { epoch: "e", revision, start, total, messages, meta: { title: "T" } };
}

const ids = (v: { conversation: { messages: ConversationMessage[] } }) =>
  v.conversation.messages.map((m) => m.textBlocks[0]);

describe("transcript window", () => {
  it("applies appends, updates and meta in revision order", () => {
    const viewed = fromPage(page(8, 10));
    const out = applyDelta(viewed, {
      agentId: "a",
      epoch: "e",
      revision: 5,
      total: 11,
      ops: [
        { op: "update", index: 9, message: msg(9, "edited") },
        { op: "append", index: 10, message: msg(10) },
      ],
      meta: { title: "New", pendingToolName: null },
    });

    expect(out.kind).toBe("applied");
    if (out.kind !== "applied") {
      return;
    }
    expect(ids(out.viewed)).toEqual(["m8", "edited", "m10"]);
    expect(out.appended.map((m) => m.id)).toEqual(["m10"]);
    expect(out.viewed.conversation.title).toBe("New");
    expect(out.viewed.window).toEqual({
      epoch: "e",
      revision: 5,
      start: 8,
      total: 11,
    });
  });

  it("ignores updates to messages it hasn't loaded", () => {
    const out = applyDelta(fromPage(page(8, 10)), {
      agentId: "a",
      epoch: "e",
      revision: 5,
      total: 10,
      ops: [{ op: "update", index: 2, message: msg(2, "x") }],
    });

    expect(out.kind === "applied" && ids(out.viewed)).toEqual(["m8", "m9"]);
  });

  it("drops what it already has and flags a gap or a new epoch", () => {
    const viewed = fromPage(page(0, 2));
    const base = { agentId: "a", total: 2, ops: [] };

    expect(applyDelta(viewed, { ...base, epoch: "e", revision: 4 }).kind).toBe(
      "stale",
    );
    expect(applyDelta(viewed, { ...base, epoch: "e", revision: 6 }).kind).toBe(
      "gap",
    );
    expect(
      applyDelta(viewed, { ...base, epoch: "other", revision: 5 }).kind,
    ).toBe("gap");
    expect(
      applyDelta(viewed, {
        ...base,
        epoch: "e",
        revision: 5,
        total: 4,
        ops: [{ op: "append", index: 3, message: msg(3) }],
      }).kind,
    ).toBe("gap");
  });

  it("removes from the end, even past what is loaded", () => {
    const viewed = fromPage(page(8, 10));
    const cut = applyDelta(viewed, {
      agentId: "a",
      epoch: "e",
      revision: 5,
      total: 9,
      ops: [{ op: "remove", index: 9, id: "m9" }],
    });
    expect(cut.kind === "applied" && ids(cut.viewed)).toEqual(["m8"]);

    const cleared = applyDelta(viewed, {
      agentId: "a",
      epoch: "e",
      revision: 5,
      total: 0,
      ops: [9, 8, 7].map((i) => ({
        op: "remove" as const,
        index: i,
        id: `m${i}`,
      })),
    });
    expect(cleared.kind === "applied" && cleared.viewed.window.start).toBe(0);
    expect(cleared.kind === "applied" && ids(cleared.viewed)).toEqual([]);
  });

  it("prepends an older page only when it lines up, and trims back", () => {
    const viewed = fromPage(page(8, 10));
    const older = prependPage(viewed, page(6, 8, 10));

    expect(older && ids(older)).toEqual(["m6", "m7", "m8", "m9"]);
    expect(prependPage(viewed, page(5, 7, 10))).toBeNull();
    expect(older && trimWindow(older, 2).window.start).toBe(8);
  });
});
