import type { BackgroundState } from "./backgroundState";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  foldBackgroundLine,
  foldTurnStop,
  newBackgroundState,
  scanResumedTranscript,
} from "./backgroundState";

const fold = (state: BackgroundState, event: object) =>
  foldBackgroundLine(state, JSON.stringify(event));
const changed = (...tasks: object[]) => ({
  type: "system",
  subtype: "background_tasks_changed",
  tasks,
});
const sessionState = (state: string) => ({
  type: "system",
  subtype: "session_state_changed",
  state,
});
const assistant = (parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { content: [] },
});

function afterTurn(stop: { scheduled: number | null } | null): BackgroundState {
  const state = newBackgroundState(false);
  fold(state, sessionState("running"));
  if (stop) {
    foldTurnStop(state, { tasks: 0, ...stop });
  }
  fold(state, sessionState("idle"));

  return state;
}

describe("background tasks", () => {
  it.each(["local_bash", "local_agent", "mcp_task", "local_workflow"])(
    "counts a %s",
    (task_type) => {
      const state = newBackgroundState(false);

      fold(state, changed({ task_id: "t1", task_type }));

      expect(state.tasks).toBe(1);
    },
  );

  it("replaces the set with each change", () => {
    const state = newBackgroundState(false);
    fold(state, changed({ task_id: "a" }, { task_id: "b" }));
    fold(state, changed({ task_id: "b" }));
    expect(state.tasks).toBe(1);

    fold(state, changed());
    expect(state.tasks).toBe(0);
  });

  it("ignores ambient tasks", () => {
    const state = newBackgroundState(false);

    fold(state, changed({ task_id: "watcher", ambient: true }));

    expect(state.tasks).toBe(0);
  });

  it("takes a stop's count from a CLI that announces no changes", () => {
    const state = newBackgroundState(false);

    foldTurnStop(state, { tasks: 2, scheduled: 0 });

    expect(state.tasks).toBe(2);
  });

  it("trusts announced changes over a stop's count", () => {
    const state = newBackgroundState(false);
    fold(state, changed({ task_id: "watcher", ambient: true }));

    foldTurnStop(state, { tasks: 1, scheduled: 0 });

    expect(state.tasks).toBe(0);
  });
});

describe("scheduled wakeups", () => {
  it("are none on a fresh agent", () => {
    expect(newBackgroundState(false).scheduled).toBe(0);
  });

  it("come from the turn's stop", () => {
    expect(afterTurn({ scheduled: 2 }).scheduled).toBe(2);
    expect(afterTurn({ scheduled: 0 }).scheduled).toBe(0);
  });

  it("are unknown when the stop didn't say", () => {
    expect(afterTurn({ scheduled: null }).scheduled).toBeNull();
  });

  it("are unknown after a turn with no stop", () => {
    expect(afterTurn(null).scheduled).toBeNull();
  });

  it("don't carry a stop into the next turn", () => {
    const state = afterTurn({ scheduled: 0 });

    fold(state, sessionState("running"));
    fold(state, sessionState("idle"));

    expect(state.scheduled).toBeNull();
  });

  it("are unknown when work went on after the stop", () => {
    const state = newBackgroundState(false);
    foldTurnStop(state, { tasks: 0, scheduled: 0 });

    fold(state, assistant());
    fold(state, sessionState("idle"));

    expect(state.scheduled).toBeNull();
  });

  it("keep a stop that only a subagent talked after", () => {
    const state = newBackgroundState(false);
    foldTurnStop(state, { tasks: 1, scheduled: 0 });

    fold(state, assistant("agent-call"));
    fold(state, sessionState("idle"));

    expect(state.scheduled).toBe(0);
  });

  it("end their turn at the result on a CLI without state events", () => {
    const state = newBackgroundState(false);

    fold(state, { type: "result", subtype: "success" });

    expect(state.scheduled).toBeNull();
  });
});

describe("a resumed transcript", () => {
  function transcript(...lines: string[]): string {
    const file = path.join(
      mkdtempSync(path.join(os.tmpdir(), "argus-scan-")),
      "t.jsonl",
    );
    writeFileSync(file, `${lines.join("\n")}\n`);

    return file;
  }

  it("is unknown until it has been read", () => {
    expect(newBackgroundState(true).scheduled).toBeNull();
  });

  it("schedules nothing without a scheduling call", async () => {
    const state = newBackgroundState(true);

    await scanResumedTranscript(
      state,
      transcript('{"type":"user","text":"CronCreate, please"}'),
    );

    expect(state.scheduled).toBe(0);
  });

  it.each(["CronCreate", "ScheduleWakeup"])(
    "stays unknown after a %s call, across a read boundary too",
    async (name) => {
      const state = newBackgroundState(true);
      // A read stream's chunks are 64 KiB.
      const padding = "x".repeat(64 * 1024 - 5);

      await scanResumedTranscript(
        state,
        transcript(`${padding}{"type":"tool_use","name":"${name}"}`),
      );

      expect(state.scheduled).toBeNull();
    },
  );

  it("stays unknown without a transcript", async () => {
    const state = newBackgroundState(true);

    await scanResumedTranscript(state, null);

    expect(state.scheduled).toBeNull();
  });

  it("gives way to a turn that ended while it was read", async () => {
    const state = newBackgroundState(true);
    const scan = scanResumedTranscript(state, transcript("{}"));

    fold(state, sessionState("idle"));
    await scan;

    expect(state.scheduled).toBeNull();
  });
});
