/** A scripted runner for tests that spawn real agent sessions without a CLI. */

import type { LlmRunner, LlmRunnerSpawnArgs } from "../llm/runners/types";
import type { Session } from "../session/models";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appState } from "../../state";
import { registerRunner } from "../llm/registry";

export class FakeHandle extends EventEmitter {
  readonly runnerId = "claude-code";
  readonly sent: string[] = [];
  readonly calls: [name: string, arg?: unknown][] = [];
  killed = false;
  /** What the child does between the signal and its exit. */
  dying: () => Promise<void> | void = () => undefined;

  constructor(
    readonly args: LlmRunnerSpawnArgs,
    readonly waitForInit: () => Promise<void>,
  ) {
    super();
  }

  send = (message: string): void => {
    this.sent.push(message);
  };

  kill = async (): Promise<void> => {
    if (this.killed) {
      return;
    }
    this.killed = true;
    await this.dying();
    this.emit("exit", 143);
  };

  cleanup = (): void => {};

  interrupt = async (): Promise<void> => {
    this.calls.push(["interrupt"]);
  };

  setModel = async (model: string): Promise<void> => {
    this.calls.push(["setModel", model]);
  };

  setPermissionMode = async (mode: string): Promise<void> => {
    this.calls.push(["setPermissionMode", mode]);
  };

  setEffort = async (level: string | null): Promise<void> => {
    this.calls.push(["setEffort", level]);
  };

  respondToPermission = (decision: unknown): void => {
    this.calls.push(["respondToPermission", decision]);
  };

  initializeResponse = () => null;

  line(event: object): void {
    this.emit("stream-event", JSON.stringify(event));
  }

  init(sessionId: string): void {
    this.line({
      type: "system",
      subtype: "init",
      session_id: sessionId,
      model: "claude-haiku",
      tools: [],
    });
  }

  state(state: "idle" | "running"): void {
    this.line({ type: "system", subtype: "session_state_changed", state });
  }

  result(extra: object = {}): void {
    this.line({
      type: "result",
      subtype: "success",
      duration_ms: 1,
      result: "done",
      ...extra,
    });
  }

  /** One whole turn, as the CLI reports it. */
  turn(sessionId = "conversation-1"): void {
    this.state("running");
    this.init(sessionId);
    this.result();
    this.state("idle");
  }
}

/** Register a fake Claude Code and a ready session `s1`. */
export function fakeClaude(): {
  spawns: FakeHandle[];
  /** What the next handles' `waitForInit` answers. */
  control: {
    init: () => Promise<void>;
    preflight: () => Promise<void>;
  };
  dir: string;
} {
  const spawns: FakeHandle[] = [];
  const control = {
    init: async (): Promise<void> => undefined,
    preflight: async (): Promise<void> => undefined,
  };
  const runner: LlmRunner = {
    id: "claude-code",
    displayName: "Claude Code",
    capabilities: () => ({
      supportsMcp: false,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
      supportsSideQuestion: true,
    }),
    defaultModel: () => null,
    preflight: async () => {
      await control.preflight();

      return { ok: true, binPath: "/usr/bin/fake" };
    },
    spawn: async (args) => {
      const init = control.init;
      const handle = new FakeHandle(args, () => init());
      spawns.push(handle);

      return handle as never;
    },
    oneShot: async () => null,
  };
  registerRunner(runner);
  const dir = mkdtempSync(path.join(os.tmpdir(), "argus-agent-"));
  appState.sessions.set("s1", {
    id: "s1",
    path: dir,
    repo_root: dir,
    kind: "worktree",
    branch: "b",
    status: "ready",
    runner_id: "claude-code",
  } as unknown as Session);

  return { spawns, control, dir };
}
