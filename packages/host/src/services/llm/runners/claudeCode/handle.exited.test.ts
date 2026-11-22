import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ClaudeCodeHandle } from "./handle";

function makeHandle() {
  const stdin = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    killed: false,
  });
  const handle = new ClaudeCodeHandle({
    agentId: "a1",
    child: child as unknown as ChildProcess,
    stdin,
    combinedSystemPrompt: "",
  });
  handle.waitForInit().catch(() => undefined);

  return { child, handle, stdin };
}

type Made = ReturnType<typeof makeHandle>;

const GONE: [string, (m: Made) => void][] = [
  [
    "closed",
    ({ child }) => {
      child.exitCode = 1;
      child.emit("close", 1);
    },
  ],
  [
    "killed by a signal, its pipes still open",
    ({ child }) => {
      child.signalCode = "SIGKILL";
    },
  ],
  [
    "being killed",
    ({ child }) => {
      child.killed = true;
    },
  ],
  ["lost its stdin", ({ stdin }) => stdin.destroy()],
];

describe.each(GONE)("a Claude Code child that is %s", (_, end) => {
  it.each([
    ["interrupt", (h: ClaudeCodeHandle) => h.interrupt()],
    ["setModel", (h: ClaudeCodeHandle) => h.setModel("opus")],
    ["setPermissionMode", (h: ClaudeCodeHandle) => h.setPermissionMode("plan")],
    ["setEffort", (h: ClaudeCodeHandle) => h.setEffort("high")],
    ["mcpStatus", (h: ClaudeCodeHandle) => h.mcpStatus()],
    [
      "mcpControl",
      (h: ClaudeCodeHandle) =>
        h.mcpControl({ action: "reconnect", server: "x" }),
    ],
  ] as const)("rejects %s", async (_name, call) => {
    const made = makeHandle();
    end(made);
    const hung = new Promise((r) => setTimeout(() => r("hung"), 100));

    await expect(Promise.race([call(made.handle), hung])).rejects.toMatch(
      /isn't running/,
    );
  });

  it("refuses a send", () => {
    const made = makeHandle();
    end(made);

    expect(() => made.handle.send("hello")).toThrow(/isn't running/);
  });
});
