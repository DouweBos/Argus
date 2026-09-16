import type { Session, WorkspaceEnvConfig } from "../session/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addBroadcastTap } from "../../broadcast";
import { appState } from "../../state";
import {
  workspaceEnvValue,
  defaultShell,
  commandShell,
  setupShellCommand,
  createTerminal,
  destroyTerminal,
} from "./multiplexer";

// broadcast.ts imports electron at runtime; vitest has no windows.
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../../state", () => ({
  appState: { sessions: new Map(), terminals: new Map() },
}));
vi.mock("../session/setup", () => ({ loadArgusConfig: () => ({}) }));
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
  it("returns SHELL env var when set", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/bin/fish";
    expect(defaultShell()).toBe("/bin/fish");
    process.env.SHELL = original;
  });

  it("falls back to /bin/sh", () => {
    const original = process.env.SHELL;
    delete process.env.SHELL;
    expect(defaultShell()).toBe("/bin/sh");
    process.env.SHELL = original;
  });
});

describe("commandShell", () => {
  it("sources the interactive login shell but parses the command with sh", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    expect(commandShell("pnpm --filter ~plex-native dev")).toEqual([
      "/bin/zsh",
      ["-ilc", 'exec sh -c "$0"', "pnpm --filter ~plex-native dev"],
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

describe("terminal events on the broadcast bus", () => {
  const SESSION_ID = "session-broadcast";
  let events: { channel: string; args: unknown[] }[];
  let untap: () => void;
  let originalShell: string | undefined;

  beforeEach(() => {
    events = [];
    untap = addBroadcastTap((channel, args) => {
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
});
