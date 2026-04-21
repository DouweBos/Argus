import { execFileSync } from "node:child_process";
import type * as NodeFs from "node:fs";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fixProcessPath } from "./shellEnv";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock fs.existsSync so the fallback-dirs branch doesn't hit the real
// filesystem and pick up machine-specific paths.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof NodeFs>("node:fs");

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
  let originalAndroidHome: string | undefined;
  let originalAndroidSdkRoot: string | undefined;
  let originalJavaHome: string | undefined;
  let originalLang: string | undefined;
  let originalLcAll: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalShell = process.env.SHELL;
    originalAndroidHome = process.env.ANDROID_HOME;
    originalAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;
    originalJavaHome = process.env.JAVA_HOME;
    originalLang = process.env.LANG;
    originalLcAll = process.env.LC_ALL;
    // Pre-populate env vars that `fixProcessPath` imports from the login
    // shell so importShellEnvVars bails out early and doesn't add extra
    // execFileSync calls that would throw off the assertions below.
    process.env.ANDROID_HOME = "/prefilled";
    process.env.ANDROID_SDK_ROOT = "/prefilled";
    process.env.JAVA_HOME = "/prefilled";
    process.env.LANG = "/prefilled";
    process.env.LC_ALL = "/prefilled";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
    if (originalAndroidHome === undefined) {
      delete process.env.ANDROID_HOME;
    } else {
      process.env.ANDROID_HOME = originalAndroidHome;
    }
    if (originalAndroidSdkRoot === undefined) {
      delete process.env.ANDROID_SDK_ROOT;
    } else {
      process.env.ANDROID_SDK_ROOT = originalAndroidSdkRoot;
    }
    if (originalJavaHome === undefined) {
      delete process.env.JAVA_HOME;
    } else {
      process.env.JAVA_HOME = originalJavaHome;
    }
    if (originalLang === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = originalLang;
    }
    if (originalLcAll === undefined) {
      delete process.env.LC_ALL;
    } else {
      process.env.LC_ALL = originalLcAll;
    }
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

  it("imports ANDROID_HOME from the login shell when unset", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = "/bin/zsh";
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;
    delete process.env.JAVA_HOME;

    mockExecFileSync.mockImplementation(((_shell: string, args: string[]) => {
      const script = args[1] ?? "";
      if (script.includes("$PATH")) {
        return "/usr/bin:/bin" as never;
      }

      // The env-import script asks for ANDROID_HOME, ANDROID_SDK_ROOT, JAVA_HOME.
      return [
        "ANDROID_HOME=/Users/me/Library/Android/sdk",
        "ANDROID_SDK_ROOT=",
        "JAVA_HOME=/opt/java",
      ].join("\n") as never;
    }) as unknown as typeof execFileSync);

    fixProcessPath();

    expect(process.env.ANDROID_HOME).toBe("/Users/me/Library/Android/sdk");
    expect(process.env.JAVA_HOME).toBe("/opt/java");
    // Empty values should not clobber — ANDROID_SDK_ROOT stays unset.
    expect(process.env.ANDROID_SDK_ROOT).toBeUndefined();
  });

  it("no-ops when PATH is undefined", () => {
    delete process.env.PATH;
    process.env.SHELL = "/bin/zsh";

    mockExecFileSync.mockReturnValue("/usr/bin:/bin" as never);

    fixProcessPath();

    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });
});
