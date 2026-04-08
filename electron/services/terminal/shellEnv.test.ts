import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";

import { fixProcessPath } from "./shellEnv";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock fs.existsSync so the fallback-dirs branch doesn't hit the real
// filesystem and pick up machine-specific paths.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => false) },
    existsSync: vi.fn(() => false),
  };
});

const mockExecFileSync = vi.mocked(execFileSync);

describe("fixProcessPath", () => {
  let originalPath: string | undefined;
  let originalShell: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalShell = process.env.SHELL;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
  });

  it("updates PATH when login shell returns a different value", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = "/bin/zsh";

    mockExecFileSync.mockReturnValue(
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" as never,
    );

    fixProcessPath();

    expect(process.env.PATH).toBe(
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    );
  });

  it("does not update PATH when shell returns the same value", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = "/bin/zsh";

    mockExecFileSync.mockReturnValue("/usr/bin:/bin" as never);

    fixProcessPath();

    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });

  it("handles shell execution failure gracefully", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = "/bin/zsh";

    mockExecFileSync.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    // Should not throw
    fixProcessPath();

    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });

  it("tries interactive login first, then login-only", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = "/bin/zsh";

    // First call (interactive) fails, second (login) succeeds
    mockExecFileSync
      .mockImplementationOnce(() => {
        throw new Error("interactive failed");
      })
      .mockReturnValueOnce("/opt/homebrew/bin:/usr/bin:/bin" as never);

    fixProcessPath();

    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("no-ops when PATH is undefined", () => {
    delete process.env.PATH;
    process.env.SHELL = "/bin/zsh";

    mockExecFileSync.mockReturnValue("/usr/bin:/bin" as never);

    fixProcessPath();

    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });
});
