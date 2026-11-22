import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeHandle } from "./claudeCode/handle";
import { CodexHandle } from "./codex/handle";
import { killChild } from "./killChild";

const PID = 4_000_001;

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: PID,
    exitCode: null as number | null,
    signalCode: null as string | null,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;

      return true;
    }),
  });

  return child;
}

type Fake = ReturnType<typeof fakeChild>;

const KILLS: [string, (child: Fake) => () => Promise<void>][] = [
  ["killChild", (c) => () => killChild(c as unknown as ChildProcess, "a1")],
  [
    "Claude Code",
    (c) => {
      const handle = new ClaudeCodeHandle({
        agentId: "a1",
        child: c as unknown as ChildProcess,
        stdin: c.stdin,
        combinedSystemPrompt: "",
      });

      return () => handle.kill();
    },
  ],
  [
    "Codex",
    (c) => {
      const handle = new CodexHandle({
        agentId: "a1",
        child: c as unknown as ChildProcess,
        cwd: "/",
        model: null,
        permissionMode: "auto",
        resumeRef: null,
        developerInstructions: "",
        mcpServers: {},
        clientVersion: "1.0.0",
      });
      handle.waitForInit().catch(() => undefined);

      return () => handle.kill();
    },
  ],
];

describe.each(KILLS)("%s's kill", (_name, killer) => {
  let signal: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    signal = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("leaves a pid alone that a signal already reaped", async () => {
    const child = fakeChild();
    child.signalCode = "SIGKILL";
    const kill = killer(child);

    const done = kill();
    await vi.advanceTimersByTimeAsync(4000);
    await done;

    expect(signal).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("doesn't escalate on a child SIGTERM took, its pipes still open", async () => {
    const child = fakeChild();
    const kill = killer(child);
    child.kill.mockImplementation(() => {
      child.signalCode = "SIGTERM";

      return true;
    });

    const done = kill();
    await vi.advanceTimersByTimeAsync(4000);
    await done;

    expect(signal).not.toHaveBeenCalled();
  });

  it("escalates on one that ignores SIGTERM", async () => {
    const child = fakeChild();
    const kill = killer(child);

    const done = kill();
    await vi.advanceTimersByTimeAsync(4000);
    await done;

    expect(signal).toHaveBeenCalledWith(PID, "SIGKILL");
  });

  it("makes a second caller wait for the first kill", async () => {
    const child = fakeChild();
    const kill = killer(child);
    const first = kill();
    let settled = false;

    const second = kill().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4000);
    await Promise.all([first, second]);
  });
});
