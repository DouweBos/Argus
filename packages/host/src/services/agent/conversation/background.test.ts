import type { AgentConversation, LlmStreamEvent } from "./types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runningBackgroundCalls,
  stillRunningLabel,
  withBackgroundSettled,
} from "./background";
import { hasRunningSubagents } from "./delta";
import { emptyConversation, reduceEvent } from "./reducer";
import { visibleMessage } from "./visibility";

const usage = { input_tokens: 1, output_tokens: 1 };
const assistant = (content: unknown[], parent?: string): LlmStreamEvent =>
  ({
    type: "assistant",
    message: { content, model: "m", usage },
    parent_tool_use_id: parent ?? null,
  }) as LlmStreamEvent;
const result = (id: string, text: string): LlmStreamEvent =>
  ({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: text }],
    },
  }) as LlmStreamEvent;
const notification = (
  id: string,
  status: "completed" | "failed" | "stopped",
  durationMs?: number,
): LlmStreamEvent => ({
  type: "system",
  subtype: "task_notification",
  task_id: "t",
  tool_use_id: id,
  status,
  ...(durationMs != null ? { usage: { duration_ms: durationMs } } : {}),
});

const call = (conv: AgentConversation, i = 0) =>
  conv.messages[i]!.toolCalls[0]!;

function launchAgent(): AgentConversation {
  let conv = reduceEvent(
    emptyConversation(),
    assistant([
      {
        type: "tool_use",
        id: "agent",
        name: "Agent",
        input: { description: "Go", prompt: "go", run_in_background: true },
      },
    ]),
  );
  conv = reduceEvent(
    conv,
    result("agent", "Async agent launched successfully."),
  );

  return conv;
}

describe("background tasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a run_in_background launch running from when it started", () => {
    const conv = launchAgent();
    expect(call(conv).background).toEqual({
      status: "running",
      startedAt: 1_000_000,
    });
    expect(hasRunningSubagents(conv.messages)).toBe(true);
  });

  it("leaves foreground calls alone", () => {
    const conv = reduceEvent(
      emptyConversation(),
      assistant([
        { type: "tool_use", id: "b", name: "Bash", input: { command: "ls" } },
      ]),
    );
    expect(call(conv).background).toBeUndefined();
  });

  it("settles on the matching notification with the reported duration", () => {
    let conv = launchAgent();
    vi.setSystemTime(1_005_000);
    conv = reduceEvent(conv, notification("agent", "completed", 1_121_000));
    expect(call(conv).background).toEqual({
      status: "completed",
      startedAt: 1_000_000,
      durationMs: 1_121_000,
    });
    expect(hasRunningSubagents(conv.messages)).toBe(false);
  });

  it("times a notification without usage from the launch", () => {
    let conv = reduceEvent(
      emptyConversation(),
      assistant([
        {
          type: "tool_use",
          id: "bash",
          name: "Bash",
          input: { command: "sleep 9", run_in_background: true },
        },
      ]),
    );
    vi.setSystemTime(1_009_000);
    conv = reduceEvent(conv, notification("bash", "failed"));
    expect(call(conv).background).toEqual({
      status: "failed",
      startedAt: 1_000_000,
      durationMs: 9_000,
    });
  });

  it("ignores notifications for foreground tasks", () => {
    let conv = launchAgent();
    conv = reduceEvent(
      conv,
      assistant(
        [
          {
            type: "tool_use",
            id: "inner",
            name: "Bash",
            input: { command: "x" },
          },
        ],
        "agent",
      ),
    );
    const before = conv;
    expect(reduceEvent(conv, notification("inner", "completed"))).toBe(before);
  });

  it("tracks a call moved to the background by task_started", () => {
    let conv = reduceEvent(
      emptyConversation(),
      assistant([
        { type: "tool_use", id: "b", name: "Bash", input: { command: "make" } },
      ]),
    );
    conv = reduceEvent(conv, {
      type: "system",
      subtype: "task_started",
      task_id: "t",
      tool_use_id: "b",
      is_backgrounded: true,
    });
    expect(call(conv).background?.status).toBe("running");
  });

  it("stops whatever is still running when the CLI goes away", () => {
    const conv = launchAgent();
    vi.setSystemTime(1_002_000);
    const settled = withBackgroundSettled(conv, Date.now());
    expect(call(settled).background).toEqual({
      status: "stopped",
      startedAt: 1_000_000,
      durationMs: 2_000,
    });
    expect(withBackgroundSettled(settled, Date.now())).toBe(settled);
  });

  it("shows a running background call as stopped once the agent is gone", () => {
    const conv = launchAgent();
    const shown = visibleMessage(conv.messages[0]!, { settled: true });
    expect(shown?.toolCalls[0]?.background?.status).toBe("stopped");
  });

  it("labels what a turn left running", () => {
    const conv = launchAgent();
    const running = runningBackgroundCalls(conv.messages);
    expect(stillRunningLabel(running)).toBe("1 agent still running");
    expect(
      stillRunningLabel([
        ...running,
        { name: "Agent", background: { status: "running" } },
      ]),
    ).toBe("2 agents still running");
    expect(
      stillRunningLabel([
        ...running,
        { name: "Bash", background: { status: "running" } },
      ]),
    ).toBe("2 background tasks still running");
    expect(stillRunningLabel([])).toBeNull();
  });
});
