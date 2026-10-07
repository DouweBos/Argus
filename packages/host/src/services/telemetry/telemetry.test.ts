/**
 * Consent outlives the process: whatever a client last set is applied at the
 * next boot, before any client attaches to say it again.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("telemetry consent", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-telemetry-"));
    vi.stubEnv("ARGUS_HOME", home);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("is stored when a client sets it and applied at the next boot", async () => {
    const first = await import("./telemetry");
    first.setTelemetryMode("full");
    const { loadAppSettings } = await import("../appSettings/store");
    expect(loadAppSettings().telemetry_mode).toBe("full");

    vi.resetModules();
    const next = await import("./telemetry");
    expect(next.getTelemetryMode()).toBe("presence");
    next.initTelemetry();
    expect(next.getTelemetryMode()).toBe("full");
  });

  it("doesn't store a choice nobody made", async () => {
    const telemetry = await import("./telemetry");
    telemetry.initTelemetry();
    const { loadAppSettings } = await import("../appSettings/store");
    expect(loadAppSettings().telemetry_mode).toBeUndefined();
  });
});
