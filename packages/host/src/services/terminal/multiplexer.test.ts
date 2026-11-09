import type { Session, WorkspaceEnvConfig } from "../session/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink } from "@argus/host/bus";
import { appState } from "../../state";
import {
  workspaceEnvValue,
  defaultShell,
  commandShell,
  setupShellCommand,
  setupShell,
  createTerminal,
  destroyTerminal,
  terminalScrollback,
  writeTerminalOutput,
} from "./multiplexer";

vi.mock("../../state", () => ({
  appState: { sessions: new Map(), terminals: new Map() },
}));
vi.mock("../session/argusConfig", () => ({ loadArgusConfig: () => ({}) }));
vi.mock("../claudeAuth/accounts", () => ({
  envForAccount: () => process.env,
  resolveAccountForSession: () => null,
}));

describe("workspaceEnvValue", () => {
  it("uses sequential strategy with envIndex", () => {
    const config: WorkspaceEnvConfig = {
      name: "PORT",
      base_value: 3000,
      range: 100,
      strategy: "sequential",
    };
    expect(workspaceEnvValue("ws-1", 0, config)).toBe(3000);
    expect(workspaceEnvValue("ws-2", 5, config)).toBe(3005);
  });

  it("uses 0 when envIndex is undefined for sequential", () => {
    const config: WorkspaceEnvConfig = {
      name: "PORT",
      base_value: 3000,
      range: 100,
      strategy: "sequential",
    };
    expect(workspaceEnvValue("ws-1", undefined, config)).toBe(3000);
  });

  it("uses hash strategy by default", () => {
    const config: WorkspaceEnvConfig = {
      name: "PORT",
      base_value: 8081,
      range: 1000,
      strategy: "hash",
    };
    const val = workspaceEnvValue("session-abc", undefined, config);
    expect(val).toBeGreaterThanOrEqual(8081);
    expect(val).toBeLessThan(9081);
  });

  it("produces deterministic hash values", () => {
    const config: WorkspaceEnvConfig = {
      name: "PORT",
      base_value: 8081,
      range: 1000,
      strategy: "hash",
    };
    const a = workspaceEnvValue("test-id", undefined, config);
    const b = workspaceEnvValue("test-id", undefined, config);
    expect(a).toBe(b);
  });

  it("produces different values for different session IDs", () => {
    const config: WorkspaceEnvConfig = {
      name: "PORT",
      base_value: 8081,
      range: 1000,
      strategy: "hash",
    };
    const a = workspaceEnvValue("session-a", undefined, config);
    const b = workspaceEnvValue("session-b", undefined, config);
    // Technically could collide, but extremely unlikely for different inputs
    expect(a).not.toBe(b);
  });

  it("falls back to defaults for missing config values", () => {
    const config = {
      name: "PORT",
    } as WorkspaceEnvConfig;
    const val = workspaceEnvValue("test", undefined, config);
    // base_value defaults to 8081, range defaults to 1000
    expect(val).toBeGreaterThanOrEqual(8081);
    expect(val).toBeLessThan(9081);
  });

  it("handles range of 0 by defaulting to 1000", () => {
    const config: WorkspaceEnvConfig = {
      name: "PORT",
      base_value: 3000,
      range: 0,
      strategy: "hash",
    };
    const val = workspaceEnvValue("test", undefined, config);
    expect(val).toBeGreaterThanOrEqual(3000);
    expect(val).toBeLessThan(4000);
  });
});

describe("defaultShell", () => {
  /** `/bin/sh` is the one shell every POSIX box is guaranteed to have. */
  const REAL_SHELL = "/bin/sh";

  it("returns SHELL when it names a shell that is actually here", () => {
    const original = process.env.SHELL;
    process.env.SHELL = REAL_SHELL;
    expect(defaultShell()).toBe(REAL_SHELL);
    process.env.SHELL = original;
  });

  it("falls back to /bin/sh", () => {
    const original = process.env.SHELL;
    delete process.env.SHELL;
    expect(defaultShell()).toBe("/bin/sh");
    process.env.SHELL = original;
  });

  it("ignores a SHELL that is not installed, rather than failing to spawn", () => {
    // A CI image that exports /bin/zsh without shipping it, or a dotfile
    // carried to a new machine. Trusting it surfaces as `posix_spawnp failed`
    // from inside node-pty, which names nothing useful.
    const original = process.env.SHELL;
    process.env.SHELL = "/bin/definitely-not-installed";
    expect(defaultShell()).toBe("/bin/sh");
    process.env.SHELL = original;
  });

  it("ignores a bare SHELL name, since node-pty needs a path", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "zsh";
    expect(defaultShell()).toBe("/bin/sh");
    process.env.SHELL = original;
  });
});

describe("commandShell", () => {
  it("sources the interactive login shell but parses the command with sh", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    expect(commandShell("pnpm --filter ~mobile-native dev")).toEqual([
      "/bin/zsh",
      ["-ilc", 'exec sh -c "$0"', "pnpm --filter ~mobile-native dev"],
    ]);
    process.env.SHELL = original;
  });

  it("falls back to plain sh for unrecognised shells", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/usr/bin/nu";
    expect(commandShell("echo hi")).toEqual(["sh", ["-c", "echo hi"]]);
    process.env.SHELL = original;
  });
});

describe("setupShellCommand", () => {
  it("execs a shell with line editing disabled", () => {
    const cmd = setupShellCommand();
    expect(cmd).toMatch(/exec \S*(bash --noediting|\/bin\/sh)/);
  });

  it("blanks the prompt so it can't be mistaken for command output", () => {
    expect(setupShellCommand()).toContain("PS1=");
  });
});

describe("setupShell", () => {
  const SESSION_ID = "session-setup-shell";
  const saved = { HOME: process.env.HOME, SHELL: process.env.SHELL };
  let home: string;

  beforeEach(() => {
    // An rc that reads the terminal, as oh-my-zsh's update prompt does.
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-setup-shell-"));
    fs.writeFileSync(path.join(home, ".bash_profile"), "read -r -n 1 answer\n");
    process.env.HOME = home;
    process.env.SHELL = "/bin/bash";
    appState.sessions.set(SESSION_ID, {
      id: SESSION_ID,
      kind: "project_root",
      path: home,
      repo_root: home,
    } as Session);
  });

  afterEach(() => {
    for (const id of appState.terminals.keys()) {
      destroyTerminal(id);
    }
    process.env.HOME = saved.HOME;
    process.env.SHELL = saved.SHELL;
    appState.sessions.clear();
    appState.terminals.clear();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it.skipIf(!fs.existsSync("/bin/bash"))(
    "keeps rc files from swallowing the first command written to it",
    async () => {
      const id = createTerminal(SESSION_ID, undefined, setupShell());
      const pty = appState.terminals.get(id)!.pty;
      let output = "";
      const done = new Promise<string>((resolve) => {
        pty.onData((data) => {
          output += data;
          const match = /__DONE__:(\d+)/.exec(output);
          if (match) {
            resolve(match[1]);
          }
        });
      });
      pty.write(`echo "ok-$((1 + 1))"; printf '\\n__DONE__:%s\\n' "$?"\n`);

      await expect(done).resolves.toBe("0");
      expect(output).toContain("ok-2");
    },
  );
});

describe("terminal events on the broadcast bus", () => {
  const SESSION_ID = "session-broadcast";
  let events: { channel: string; args: unknown[] }[];
  let untap: () => void;
  let originalShell: string | undefined;

  beforeEach(() => {
    events = [];
    untap = addHostEventSink((channel, args) => {
      events.push({ channel, args });
    });
    // Unrecognised shell → `sh -c <command>`, skipping the user's rc files.
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
    process.env.SHELL = originalShell;
    appState.sessions.clear();
    appState.terminals.clear();
  });

  /** Resolve with the args of the first broadcast on `channel`. */
  function waitForChannel(channel: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${channel}`));
      }, 5000);
      const poll = setInterval(() => {
        const hit = events.find((e) => e.channel === channel);
        if (hit) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve(hit.args);
        }
      }, 10);
    });
  }

  it("publishes PTY output and exit to a registered tap", async () => {
    const id = createTerminal(SESSION_ID, undefined, "printf hello; exit 3");

    await expect(waitForChannel(`terminal:exit:${id}`)).resolves.toEqual([3]);

    const data = events
      .filter((e) => e.channel === `terminal:data:${id}`)
      .map((e) => Buffer.from(e.args[0] as string, "base64").toString())
      .join("");
    expect(data).toBe("hello");
  });

  it("publishes terminal:exit with -1 when a terminal is destroyed", async () => {
    const id = createTerminal(SESSION_ID, undefined, "sleep 30");
    destroyTerminal(id);

    await expect(waitForChannel(`terminal:exit:${id}`)).resolves.toEqual([-1]);
  });

  it("replays what was broadcast, and nothing still waiting to flush", async () => {
    const id = createTerminal(SESSION_ID, undefined, "printf hello; exit 0");
    await waitForChannel(`terminal:exit:${id}`);

    const replay = terminalScrollback(id);
    expect(Buffer.from(replay.data, "base64").toString()).toBe("hello");
    expect(replay).toMatchObject({
      exited: true,
      exitCode: 0,
      truncated: false,
    });

    const terminal = appState.terminals.get(id)!;
    terminal.outputLog += "pending";
    terminal.unflushedChars = "pending".length;
    expect(Buffer.from(terminalScrollback(id).data, "base64").toString()).toBe(
      "hello",
    );
  });

  it("starts a truncated replay at a line boundary", async () => {
    const id = createTerminal(SESSION_ID, undefined, "exit 0");
    await waitForChannel(`terminal:exit:${id}`);
    const terminal = appState.terminals.get(id)!;
    terminal.outputLog = "[31mtail of a line\nnext line\n";
    terminal.outputDroppedBytes = 10;

    const replay = terminalScrollback(id);
    expect(Buffer.from(replay.data, "base64").toString()).toBe("next line\n");
    expect(replay.truncated).toBe(true);
  });

  it("captures text the host writes into a terminal, so it replays too", async () => {
    const id = createTerminal(SESSION_ID, undefined, "sleep 30");
    writeTerminalOutput(id, "banner\r\n");
    await waitForChannel(`terminal:data:${id}`);

    expect(
      Buffer.from(terminalScrollback(id).data, "base64").toString(),
    ).toContain("banner");
    destroyTerminal(id);
  });

  it("rejects an unknown terminal", () => {
    expect(() => terminalScrollback("nope")).toThrow();
  });
});
