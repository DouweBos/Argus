import type { RuntimeContext } from "./runtimePrompt";
import type { RuntimePlatform } from "../session/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tools = vi.hoisted(() => ({ deviceControl: true }));
vi.mock("../tools/state", () => ({
  toolEnabled: () => tools.deviceControl,
}));

const {
  CONDUCTOR_GUIDE,
  buildRuntimeSection,
  deviceControlEnabled,
  resolveRuntimePlatforms,
} = await import("./runtimePrompt");

function ctx(
  platforms: RuntimePlatform[],
  extra: Partial<RuntimeContext> = {},
): RuntimeContext {
  return {
    platforms: new Set(platforms),
    iosReservation: null,
    androidDevices: [],
    browserSession: null,
    browserUrl: null,
    ...extra,
  };
}

const tmpDirs: string[] = [];
function repoWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-prompt-"));
  tmpDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }

  return dir;
}

function cleanUp() {
  tools.deviceControl = true;
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("buildRuntimeSection", () => {
  it("is absent for a project with no runtime", () => {
    expect(buildRuntimeSection(ctx([]))).toBeNull();
  });

  it("carries the shared conductor guide for every platform", () => {
    for (const p of ["ios", "android", "tvos", "web"] as const) {
      expect(buildRuntimeSection(ctx([p]))).toContain(CONDUCTOR_GUIDE);
    }
  });

  it("names the capabilities subagents used to think were missing", () => {
    for (const needle of [
      "conductor workspace info",
      "--long-press",
      "set-orientation",
      "start-device",
      "install-app",
      "inspect",
      "xcrun simctl",
      "devices you create yourself",
    ]) {
      expect(CONDUCTOR_GUIDE).toContain(needle);
    }
  });

  it("pins the reserved simulator", () => {
    const text = buildRuntimeSection(
      ctx(["ios"], {
        iosReservation: {
          udid: "UDID-1",
          deviceName: "Argus-3",
        } as RuntimeContext["iosReservation"],
      }),
    );
    expect(text).toContain("**Argus-3** (UDID `UDID-1`");
    expect(text).toContain('pnpm ios --device "Argus-3"');
  });

  it("lists booted Android devices and the attached browser", () => {
    const text = buildRuntimeSection(
      ctx(["android", "web"], {
        androidDevices: [
          {
            serial: "emulator-5554",
            deviceName: "Pixel",
            type: "emulator",
            captureActive: true,
          },
        ],
        browserSession: {} as RuntimeContext["browserSession"],
        browserUrl: "http://localhost:3000",
      }),
    );
    expect(text).toContain("--device emulator-5554");
    expect(text).toContain("A browser view at **http://localhost:3000**");
    expect(text).not.toContain("### iOS simulator");
  });
});

describe("resolveRuntimePlatforms", () => {
  afterEach(cleanUp);

  const base = {
    hasIosReservation: false,
    hasBrowserSession: false,
  };

  it("prefers the override over detection", () => {
    const repoRoot = repoWith({
      "package.json": JSON.stringify({ dependencies: { expo: "52.0.0" } }),
    });
    expect([
      ...resolveRuntimePlatforms({ ...base, repoRoot, override: ["tvos"] }),
    ]).toEqual(["tvos"]);
  });

  it("ignores a legacy platforms key in .argus.json", () => {
    const repoRoot = repoWith({
      ".argus.json": JSON.stringify({ platforms: ["web"] }),
      "go.mod": "module x",
    });
    expect(resolveRuntimePlatforms({ ...base, repoRoot }).size).toBe(0);
  });

  it("detects a frontend project", () => {
    const repoRoot = repoWith({
      "package.json": JSON.stringify({ dependencies: { expo: "52.0.0" } }),
    });
    expect([...resolveRuntimePlatforms({ ...base, repoRoot })].sort()).toEqual([
      "android",
      "ios",
    ]);
  });

  it("finds nothing in a backend-only repo, unless a device is attached", () => {
    const repoRoot = repoWith({ "go.mod": "module x" });
    expect(resolveRuntimePlatforms({ ...base, repoRoot }).size).toBe(0);
    expect([
      ...resolveRuntimePlatforms({
        ...base,
        repoRoot,
        hasIosReservation: true,
      }),
    ]).toEqual(["ios"]);
  });
});

describe("deviceControlEnabled", () => {
  afterEach(cleanUp);

  it("is on unless the tool is off app-wide or for the project", () => {
    expect(deviceControlEnabled(null)).toBe(true);
    expect(deviceControlEnabled({ disabled: ["device-recording"] })).toBe(true);
    expect(deviceControlEnabled({ disabled: ["device-control"] })).toBe(false);
    tools.deviceControl = false;
    expect(deviceControlEnabled(null)).toBe(false);
  });
});
