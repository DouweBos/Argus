import type { RunCommand, Session } from "../session/models";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink } from "@argus/host/bus";
import { appState } from "../../state";
import {
  createRunTerminal,
  createTerminal,
  destroyTerminal,
  waitForTerminal,
} from "./multiplexer";
import { stopTerminalGracefully } from "./stop";

vi.mock("../../state", () => ({
  appState: { sessions: new Map(), terminals: new Map() },
}));
const runCommands: RunCommand[] = [];
vi.mock("../session/argusConfig", () => ({
  loadArgusConfig: () => ({ run: runCommands, workspace_env: [] }),
}));
vi.mock("../claudeAuth/accounts", () => ({
  envForAccount: () => process.env,
  resolveAccountForSession: () => null,
}));

const SESSION_ID = "session-stop";
const GRACE_MS = 400;

/** A `sh -c` wrapper around a node child; `script` runs in the child. */
function wrapped(script: string): string {
  const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  const child = `${quote(process.execPath)} -e ${quote(
    `process.on("SIGHUP", () => {}); ${script} console.log("CHILD:" + process.pid); setInterval(() => {}, 1000);`,
  )}`;

  // The trailing `echo` keeps sh from exec'ing into node, so the chain stays two deep.
  return `${child}; echo after`;
}

async function childPid(terminalId: string): Promise<number> {
  const result = await waitForTerminal(terminalId, {
    untilPattern: "CHILD:\\d+",
    timeoutMs: 10_000,
  });
  const match = /CHILD:(\d+)/.exec(result.output);
  if (!match) {
    throw new Error(`child never started: ${result.output}`);
  }

  return Number(match[1]);
}

/** Live (non-zombie) pids among `pids`. */
function alive(pids: number[]): number[] {
  return pids.filter((pid) => {
    try {
      const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)])
        .toString()
        .trim();

      return stat !== "" && !stat.startsWith("Z");
    } catch {
      return false;
    }
  });
}

describe("stopTerminalGracefully", () => {
  let events: { channel: string; args: unknown[] }[];
  let untap: () => void;
  let originalShell: string | undefined;

  beforeEach(() => {
    events = [];
    untap = addHostEventSink((channel, args) => {
      events.push({ channel, args });
    });
    // `sh` → `sh -c <command>`, skipping the user's rc files.
    originalShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    appState.sessions.set(SESSION_ID, {
      id: SESSION_ID,
      kind: "project_root",
      path: process.cwd(),
      repo_root: process.cwd(),
    } as Session);
  });

  afterEach(() => {
    untap();
    for (const id of Array.from(appState.terminals.keys())) {
      destroyTerminal(id);
    }
    runCommands.length = 0;
    process.env.SHELL = originalShell;
    appState.sessions.clear();
    appState.terminals.clear();
  });

  it("stops a wrapper chain with SIGINT and leaves no orphans", async () => {
    const id = createTerminal(SESSION_ID, undefined, wrapped(""));
    const terminal = appState.terminals.get(id)!;
    const child = await childPid(id);

    const outcome = await stopTerminalGracefully(id, "mcp", GRACE_MS);

    expect(outcome).toMatchObject({
      stopped: true,
      alreadyExited: false,
      step: "SIGINT",
      exitCode: 130,
      exitSignal: "SIGINT",
      survivors: [],
    });
    expect(alive([terminal.pid, child])).toEqual([]);
    // The UI sees a natural exit.
    expect(
      events.some(
        (e) =>
          e.channel === `terminal:exit:${id}` &&
          e.args[0] === terminal.exitCode,
      ),
    ).toBe(true);
  });

  it("escalates to SIGTERM when SIGINT is ignored", async () => {
    const id = createTerminal(
      SESSION_ID,
      undefined,
      wrapped(`process.on("SIGINT", () => {});`),
    );
    const terminal = appState.terminals.get(id)!;
    const child = await childPid(id);

    const outcome = await stopTerminalGracefully(id, "mcp", GRACE_MS);

    expect(outcome).toMatchObject({ stopped: true, step: "SIGTERM" });
    expect(alive([terminal.pid, child])).toEqual([]);
  });

  it("escalates to SIGKILL when SIGINT and SIGTERM are ignored", async () => {
    const id = createTerminal(
      SESSION_ID,
      undefined,
      wrapped(
        `process.on("SIGINT", () => {}); process.on("SIGTERM", () => {});`,
      ),
    );
    const terminal = appState.terminals.get(id)!;
    const child = await childPid(id);

    const outcome = await stopTerminalGracefully(id, "mcp", GRACE_MS);

    expect(outcome).toMatchObject({ stopped: true, step: "SIGKILL" });
    expect(alive([terminal.pid, child])).toEqual([]);
  });

  it("reaches a grandchild that moved into its own process group", async () => {
    const id = createTerminal(
      SESSION_ID,
      undefined,
      wrapped(
        `const g = require("node:child_process").spawn("sleep", ["30"], { detached: true, stdio: "ignore" }); console.log("GRANDCHILD:" + g.pid);`,
      ),
    );
    await childPid(id);
    const grandchild = Number(
      /GRANDCHILD:(\d+)/.exec(appState.terminals.get(id)!.outputLog)![1],
    );

    const outcome = await stopTerminalGracefully(id, "mcp", GRACE_MS);

    expect(outcome.stopped).toBe(true);
    expect(alive([grandchild])).toEqual([]);
  });

  it("reports an already-exited terminal without signalling", async () => {
    const id = createTerminal(SESSION_ID, undefined, "exit 4");
    await waitForTerminal(id, { timeoutMs: 5000 });

    await expect(stopTerminalGracefully(id, "mcp")).resolves.toMatchObject({
      stopped: true,
      alreadyExited: true,
      step: null,
      exitCode: 4,
    });
  });

  it("shares one escalation between concurrent calls", async () => {
    const id = createTerminal(SESSION_ID, undefined, wrapped(""));
    await childPid(id);

    const [a, b] = await Promise.all([
      stopTerminalGracefully(id, "mcp", GRACE_MS),
      stopTerminalGracefully(id, "mcp", GRACE_MS),
    ]);

    expect(a).toBe(b);
  });

  it("rejects an unknown terminal", () => {
    expect(() => stopTerminalGracefully("nope", "mcp")).toThrow();
  });

  it("restarts a run gracefully and starts the rerun cleanly", async () => {
    runCommands.push({
      title: "dev",
      command: wrapped(""),
      restartOnRerun: true,
    } as RunCommand);

    const first = await createRunTerminal(SESSION_ID, "dev");
    const firstChild = await childPid(first.sessionId);
    const second = await createRunTerminal(SESSION_ID, "dev");

    expect(second.started).toBe(true);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(appState.terminals.get(first.sessionId)!.exitSignal).not.toBe(
      "SIGKILL",
    );
    expect(alive([firstChild])).toEqual([]);
    await childPid(second.sessionId);
    expect(appState.terminals.get(second.sessionId)!.exitCode).toBeNull();
  });
});
