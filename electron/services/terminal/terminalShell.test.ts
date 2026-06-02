import { afterEach, describe, expect, it } from "vitest";
import { defaultShell, resolveTerminalSpawn } from "./terminalShell";

describe("terminalShell", () => {
  const originalShell = process.env.SHELL;
  const originalComspec = process.env.COMSPEC;

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
    if (originalComspec === undefined) {
      delete process.env.COMSPEC;
    } else {
      process.env.COMSPEC = originalComspec;
    }
  });

  describe("defaultShell", () => {
    it("returns $SHELL when set, on any platform", () => {
      process.env.SHELL = "/bin/fish";
      expect(defaultShell("linux")).toBe("/bin/fish");
      expect(defaultShell("darwin")).toBe("/bin/fish");
      expect(defaultShell("win32")).toBe("/bin/fish");
    });

    it("falls back to /bin/sh on POSIX when $SHELL is unset", () => {
      delete process.env.SHELL;
      expect(defaultShell("linux")).toBe("/bin/sh");
      expect(defaultShell("darwin")).toBe("/bin/sh");
    });

    it("falls back to powershell.exe on Windows when $SHELL is unset", () => {
      delete process.env.SHELL;
      expect(defaultShell("win32")).toBe("powershell.exe");
    });
  });

  describe("resolveTerminalSpawn", () => {
    it("launches the interactive shell when no command is given", () => {
      process.env.SHELL = "/bin/zsh";
      expect(resolveTerminalSpawn(undefined, "linux")).toEqual([
        "/bin/zsh",
        [],
      ]);
      delete process.env.SHELL;
      expect(resolveTerminalSpawn(undefined, "win32")).toEqual([
        "powershell.exe",
        [],
      ]);
    });

    it("runs a one-shot command via sh -c on POSIX", () => {
      expect(resolveTerminalSpawn("pnpm dev", "linux")).toEqual([
        "sh",
        ["-c", "pnpm dev"],
      ]);
    });

    it("runs a one-shot command via cmd.exe /d /s /c on Windows", () => {
      process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
      expect(resolveTerminalSpawn("pnpm dev", "win32")).toEqual([
        "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/c", "pnpm dev"],
      ]);
    });

    it("falls back to cmd.exe when COMSPEC is unset on Windows", () => {
      delete process.env.COMSPEC;
      expect(resolveTerminalSpawn("echo hi", "win32")).toEqual([
        "cmd.exe",
        ["/d", "/s", "/c", "echo hi"],
      ]);
    });
  });
});
