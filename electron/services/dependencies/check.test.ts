import { execFile } from "node:child_process";
import fs from "node:fs";
import type NodeFs from "node:fs";
import path from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDependencies,
  defaultAndroidSdkRoots,
  resolveAndroidBinary,
  resolveBinary,
} from "./check";

// Mock the conductor logger so importing it doesn't pull Electron in.
vi.mock("../conductor/logger", () => ({
  getConductorBin: () => "/tmp/fake-conductor-bin",
}));

// Mock child_process.execFile — we drive it per test. The real execFile has
// a promisify.custom override so `util.promisify(execFile)` resolves with
// `{ stdout, stderr }`; we replicate that here so our service code (which
// uses promisify) behaves identically.
vi.mock("node:child_process", () => {
  // Well-known symbol used by util.promisify; referenced directly because
  // vi.mock hoists above imports and `util` wouldn't be initialized yet.
  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
  const mockExecFile = vi.fn();
  (mockExecFile as unknown as Record<symbol, unknown>)[promisifyCustom] = (
    file: string,
    args: string[],
  ) =>
    new Promise((resolve, reject) => {
      (mockExecFile as unknown as (...a: unknown[]) => void)(
        file,
        args,
        (err: Error | null, stdout: string, stderr: string) => {
          if (err) {
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
    });

  return { execFile: mockExecFile };
});

// Mock fs so we can fake Android SDK layouts.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof NodeFs>("node:fs");

  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(actual.existsSync) },
    existsSync: vi.fn(actual.existsSync),
  };
});

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

function mockExec(map: Record<string, Error | string>): void {
  (execFile as unknown as Mock).mockImplementation(((
    _file: string,
    args: string[],
    cb: ExecCb,
  ) => {
    const key = args[0] ?? "";
    const value = map[key];
    if (value instanceof Error) {
      cb(value, "", "");
    } else if (typeof value === "string") {
      cb(null, value, "");
    } else {
      cb(new Error(`not found: ${key}`), "", "");
    }
  }) as unknown as typeof execFile);
}

describe("resolveBinary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as unknown as Mock).mockReturnValue(false);
  });

  it("returns trimmed path when `which` succeeds", async () => {
    mockExec({ claude: "/usr/local/bin/claude\n" });
    await expect(resolveBinary("claude")).resolves.toBe(
      "/usr/local/bin/claude",
    );
  });

  it("returns null when `which` fails", async () => {
    mockExec({ claude: new Error("not found") });
    await expect(resolveBinary("claude")).resolves.toBeNull();
  });

  it("returns null when stdout is empty", async () => {
    mockExec({ claude: "\n" });
    await expect(resolveBinary("claude")).resolves.toBeNull();
  });

  it("returns only the first line when `which` prints multiple", async () => {
    mockExec({ foo: "/a/foo\n/b/foo\n" });
    await expect(resolveBinary("foo")).resolves.toBe("/a/foo");
  });
});

describe("resolveAndroidBinary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as unknown as Mock).mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;
  });

  it("prefers ANDROID_HOME/<subdir>/<binary> when it exists", async () => {
    (fs.existsSync as unknown as Mock).mockReturnValue(true);
    const out = await resolveAndroidBinary("adb", "platform-tools", {
      ANDROID_HOME: "/opt/android",
    });
    expect(out).toBe(path.join("/opt/android", "platform-tools", "adb"));
  });

  it("falls back to ANDROID_SDK_ROOT when ANDROID_HOME is unset", async () => {
    (fs.existsSync as unknown as Mock).mockReturnValue(true);
    const out = await resolveAndroidBinary("adb", "platform-tools", {
      ANDROID_SDK_ROOT: "/opt/sdk",
    });
    expect(out).toBe(path.join("/opt/sdk", "platform-tools", "adb"));
  });

  it("falls back to PATH when the SDK dir lacks the binary", async () => {
    (fs.existsSync as unknown as Mock).mockReturnValue(false);
    mockExec({ adb: "/usr/bin/adb\n" });
    const out = await resolveAndroidBinary("adb", "platform-tools", {
      ANDROID_HOME: "/opt/android",
    });
    expect(out).toBe("/usr/bin/adb");
  });

  it("returns null when not found anywhere", async () => {
    (fs.existsSync as unknown as Mock).mockReturnValue(false);
    mockExec({ adb: new Error("not found") });
    await expect(
      resolveAndroidBinary("adb", "platform-tools", {}),
    ).resolves.toBeNull();
  });

  it("finds binary under the default SDK path when no env vars set", async () => {
    const expected = path.join(
      defaultAndroidSdkRoots()[0],
      "emulator",
      "emulator",
    );
    (fs.existsSync as unknown as Mock).mockImplementation(
      (p: string) => p === expected,
    );
    const out = await resolveAndroidBinary("emulator", "emulator", {});
    expect(out).toBe(expected);
  });
});

describe("defaultAndroidSdkRoots", () => {
  it("returns ~/Library/Android/sdk on darwin", () => {
    expect(defaultAndroidSdkRoots("/Users/test", "darwin")).toEqual([
      path.join("/Users/test", "Library", "Android", "sdk"),
    ]);
  });

  it("returns ~/Android/Sdk on linux", () => {
    expect(defaultAndroidSdkRoots("/home/test", "linux")).toEqual([
      path.join("/home/test", "Android", "Sdk"),
    ]);
  });
});

describe("checkDependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as unknown as Mock).mockReturnValue(false);
  });

  it("marks required binaries as missing when not on PATH", async () => {
    mockExec({});
    const report = await checkDependencies();
    const claude = report.dependencies.find((d) => d.id === "claude");
    const git = report.dependencies.find((d) => d.id === "git");
    expect(claude?.installed).toBe(false);
    expect(git?.installed).toBe(false);
    expect(report.missingRequired).toBeGreaterThanOrEqual(2);
  });

  it("marks deps as installed when `which` resolves them", async () => {
    mockExec({
      claude: "/usr/local/bin/claude\n",
      git: "/usr/bin/git\n",
      xcrun: "/usr/bin/xcrun\n",
      adb: "/usr/bin/adb\n",
      emulator: "/usr/bin/emulator\n",
    });
    const report = await checkDependencies();
    expect(
      report.dependencies.find((d) => d.id === "claude")?.resolvedPath,
    ).toBe("/usr/local/bin/claude");
    expect(report.missingRequired).toBe(0);
  });

  it("counts required misses as just the unresolved required deps", async () => {
    mockExec({ git: "/usr/bin/git\n" });
    const report = await checkDependencies();
    // Only claude is required and missing; git is required and present.
    expect(report.missingRequired).toBe(1);
    expect(report.missingOptional).toBeGreaterThanOrEqual(1);
  });

  it("treats platform-inapplicable deps as installed", async () => {
    mockExec({});
    const report = await checkDependencies();
    const xcrun = report.dependencies.find((d) => d.id === "xcrun");
    const expected = process.platform !== "darwin";
    expect(xcrun?.installed).toBe(expected);
  });

  it("returns platform and the full set of dependency ids", async () => {
    mockExec({});
    const report = await checkDependencies();
    expect(report.platform).toBe(process.platform);
    expect(report.dependencies.map((d) => d.id).sort()).toEqual(
      ["adb", "claude", "conductor", "emulator", "git", "xcrun"].sort(),
    );
  });
});
