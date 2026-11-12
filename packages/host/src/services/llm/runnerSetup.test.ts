import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodeHostPlatform,
  resetHostPlatform,
  setHostPlatform,
} from "@argus/host/platform";

const terminals = vi.hoisted(() => ({
  created: [] as { owner: string; command: string; title: string }[],
  exit: null as ((code: number) => void) | null,
}));

vi.mock("../terminal/multiplexer", () => ({
  defaultShell: () => "/bin/sh",
  createHostTerminal: (owner: string, command: string, title: string) => {
    terminals.created.push({ owner, command, title });

    return "t1";
  },
  waitForTerminal: () =>
    new Promise((resolve) => {
      terminals.exit = (exitCode) => resolve({ reason: "exit", exitCode });
    }),
}));

const events = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (channel: string, payload: unknown) =>
    events.push([channel, payload]),
}));

const captured = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../telemetry/telemetry", () => ({
  capture: (event: string, props: unknown) => captured.push([event, props]),
}));

const { startRunnerSetup } = await import("./runnerSetup");

describe("startRunnerSetup", () => {
  const opened: string[] = [];

  beforeEach(() => {
    terminals.created = [];
    events.length = 0;
    captured.length = 0;
    opened.length = 0;
    setHostPlatform({
      ...nodeHostPlatform(),
      openExternal: async (url) => {
        opened.push(url);
      },
    });
  });

  afterEach(() => resetHostPlatform());

  it("runs the install command in a terminal and announces the re-probe on exit", async () => {
    const started = await startRunnerSetup("codex", "login");
    expect(started).toEqual({ terminalId: "t1", openedUrl: null });
    expect(terminals.created).toEqual([
      {
        owner: "runner-setup",
        command: "codex login",
        title: "Sign in to Codex",
      },
    ]);

    terminals.exit?.(0);
    await vi.waitFor(() =>
      expect(events).toEqual([
        [
          "llm:runners_changed",
          { runnerId: "codex", step: "login", exitCode: 0 },
        ],
      ]),
    );
  });

  it("opens the install page for a CLI with no install command", async () => {
    const started = await startRunnerSetup("antigravity", "install");
    expect(started).toEqual({
      terminalId: null,
      openedUrl: "https://antigravity.google",
    });
    expect(opened).toEqual(["https://antigravity.google"]);
    expect(terminals.created).toEqual([]);
  });

  it("signs out from the Accounts page and counts it there, not as picker setup", async () => {
    await startRunnerSetup("cursor", "logout", "accounts");
    expect(terminals.created).toEqual([
      {
        owner: "runner-setup",
        command: "cursor-agent logout",
        title: "Sign out of Cursor",
      },
    ]);

    terminals.exit?.(0);
    await vi.waitFor(() =>
      expect(captured).toEqual([
        [
          "runner_account_action",
          { runner: "cursor", action: "sign_out", outcome: "succeeded" },
        ],
      ]),
    );
  });

  it("refuses to sign out of a CLI with no logout command", async () => {
    await expect(
      startRunnerSetup("antigravity", "logout", "accounts"),
    ).rejects.toMatch("no sign-out command");
  });

  it("refuses a runner it can't set up", async () => {
    await expect(startRunnerSetup("nope", "install")).rejects.toMatch(
      "can't be set up",
    );
    await expect(startRunnerSetup("claude-code", "login")).rejects.toMatch(
      "no sign-in command",
    );
  });
});
