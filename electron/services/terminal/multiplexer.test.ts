import type { WorkspaceEnvConfig } from "../session/models";
import { describe, expect, it, vi } from "vitest";
import { workspaceEnvValue, defaultShell, commandShell } from "./multiplexer";

// Mock node-pty (native module) and other Electron deps
vi.mock("node-pty", () => ({ spawn: vi.fn() }));
vi.mock("../../main", () => ({ getMainWindow: () => null }));
vi.mock("../../state", () => ({
  appState: { sessions: new Map(), terminals: new Map() },
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
  it("sources the login shell but parses the command with sh", () => {
    const original = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    expect(commandShell("pnpm --filter ~plex-native dev")).toEqual([
      "/bin/zsh",
      ["-lc", 'exec sh -c "$0"', "pnpm --filter ~plex-native dev"],
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
