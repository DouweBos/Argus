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
    attachedDevices: [],
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

  it("lists every device handed to the agent beside its reservation", () => {
    const text = buildRuntimeSection(
      ctx(["ios", "android"], {
        iosReservation: {
          udid: "UDID-1",
          deviceName: "Argus-3",
        } as RuntimeContext["iosReservation"],
        attachedDevices: [
          { platform: "ios", id: "UDID-PAD", name: "iPad Pro" },
          { platform: "android", id: "emulator-5556", name: "Tablet" },
        ],
        androidDevices: [
          {
            serial: "emulator-5556",
            deviceName: "Tablet",
            type: "emulator",
            captureActive: true,
          },
        ],
      }),
    )!;
    expect(text).toContain("### iOS simulators");
    expect(text).toContain("**Argus-3** (UDID `UDID-1`");
    expect(text).toContain(
      "- **iPad Pro**: `conductor <command> --device UDID-PAD`",
    );
    expect(text).toContain(
      "- **Tablet**: `conductor <command> --device emulator-5556`",
    );
    expect(text.match(/emulator-5556/g)).toHaveLength(1);
  });

  it("makes the first handed-over simulator the default without a reservation", () => {
    const text = buildRuntimeSection(
      ctx(["ios"], {
        attachedDevices: [
          { platform: "ios", id: "UDID-PHONE", name: "iPhone 17" },
          { platform: "ios", id: "UDID-PAD", name: "iPad Pro" },
        ],
      }),
    )!;
    expect(text).toContain("without `--device` targets **iPhone 17**");
    expect(text).not.toContain("reserved for you the first time");
    expect(text).toContain("xcodebuild -destination 'id=UDID-PHONE'");
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
    expect([
      ...resolveRuntimePlatforms({
        ...base,
        repoRoot,
        attachedDevices: [{ platform: "android", id: "s", name: "Pixel" }],
      }),
    ]).toEqual(["android"]);
  });
});

describe("deviceControlEnabled", () => {
  afterEach(cleanUp);

  it("is on unless the tool is off app-wide, for the project or for the agent", () => {
    expect(deviceControlEnabled(null)).toBe(true);
    expect(deviceControlEnabled({ disabled: ["device-recording"] })).toBe(true);
    expect(deviceControlEnabled({ disabled: ["device-control"] })).toBe(false);
    expect(deviceControlEnabled(null, ["device-control"])).toBe(false);
    expect(deviceControlEnabled(null, ["device-debug"])).toBe(true);
    tools.deviceControl = false;
    expect(deviceControlEnabled(null)).toBe(false);
  });
});
