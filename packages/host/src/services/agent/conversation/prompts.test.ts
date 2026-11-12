import type { ConversationMessage, ToolCallInfo } from "./types";
import { describe, expect, it } from "vitest";
import { expirePrompts, UNANSWERED_RESULT } from "./prompts";
import { fromSavedMessages } from "./reducer";

const call = (over: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  id: "q",
  name: "AskUserQuestion",
  input: { questions: [] },
  ...over,
});

const msg = (toolCalls: ToolCallInfo[]): ConversationMessage => ({
  id: "m",
  role: "assistant",
  textBlocks: [],
  toolCalls,
  timestamp: 0,
});

const expired = {
  result: UNANSWERED_RESULT,
  isError: false,
  expired: true,
};

describe("expirePrompts", () => {
  it("settles a question a restored history was still waiting on", () => {
    const conv = fromSavedMessages([
      msg([call({ pendingPermission: true })]),
      msg([call({ id: "p", name: "ExitPlanMode" })]),
    ]);
    const calls = conv.messages.flatMap((m) => m.toolCalls);
    for (const tc of calls) {
      expect(tc).toMatchObject(expired);
      expect(tc.pendingPermission).toBeUndefined();
    }
  });

  it("settles a stale permission and keeps one the runner still holds", () => {
    const [m] = expirePrompts(
      [
        msg([
          call({ id: "a", name: "Bash", pendingPermission: true }),
          call({ id: "b", name: "Bash", pendingPermission: true }),
        ]),
      ],
      { live: (id) => id === "b" },
    );
    expect(m!.toolCalls[0]).toMatchObject(expired);
    expect(m!.toolCalls[1]).toMatchObject({ pendingPermission: true });
    expect(m!.toolCalls[1]!.result).toBeUndefined();
  });

  it("drops a stale flag from a call that already has its result", () => {
    const [m] = expirePrompts([
      msg([call({ result: "Blue", pendingPermission: true })]),
    ]);
    expect(m!.toolCalls[0]).toEqual(call({ result: "Blue" }));
  });

  it("leaves a sub-agent's prompt alone at the end of the parent's turn", () => {
    const nested = call({ id: "n", name: "Bash", pendingPermission: true });
    const parent = call({
      id: "agent",
      name: "Agent",
      result: "launched",
      children: [{ kind: "tool_use", toolCall: nested }],
    });
    const messages = [msg([parent])];
    expect(expirePrompts(messages, { topLevelOnly: true })).toBe(messages);
    const [m] = expirePrompts(messages);
    const child = m!.toolCalls[0]!.children![0]!;
    expect(child.kind === "tool_use" && child.toolCall).toMatchObject(expired);
  });

  it("returns the same array when nothing is waiting", () => {
    const messages = [msg([call({ result: "Blue" })])];
    expect(expirePrompts(messages)).toBe(messages);
  });
});
