/**
 * The device store holds the host's identity and every pairing. A store this
 * host can't read must stop the gateway, never be regenerated over.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodeHostPlatform,
  resetHostPlatform,
  setHostPlatform,
} from "../../platform";

describe("remote device store", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-devstore-"));
    process.env.ARGUS_HOME = home;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.ARGUS_HOME = prevHome;
    resetHostPlatform();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("refuses an encrypted store it cannot decrypt instead of replacing it", async () => {
    setHostPlatform(nodeHostPlatform());
    const file = path.join(home, "remote-devices.json");
    const sealed = Buffer.from("ah1sealed").toString("base64");
    const original = JSON.stringify({ enc: true, data: sealed });
    fs.writeFileSync(file, original);

    const { listDevices } = await import("./deviceStore");
    await expect(listDevices()).rejects.toThrow(/encrypted/);
    expect(fs.readFileSync(file, "utf-8")).toBe(original);
  });

  it("tells a host to open Electron once when the store is in safeStorage's format", async () => {
    setHostPlatform(nodeHostPlatform());
    const file = path.join(home, "remote-devices.json");
    const original = JSON.stringify({ enc: true, data: "djEwc2VjcmV0" });
    fs.writeFileSync(file, original);

    const { listDevices } = await import("./deviceStore");
    await expect(listDevices()).rejects.toThrow(
      /Open the Argus Electron app once/,
    );
    expect(fs.readFileSync(file, "utf-8")).toBe(original);
  });

  it("creates a fresh identity when there is no store yet", async () => {
    setHostPlatform(nodeHostPlatform());
    const { getDesktopIdentity } = await import("./deviceStore");
    const identity = await getDesktopIdentity();
    expect(identity).toBeTruthy();
    expect(fs.existsSync(path.join(home, "remote-devices.json"))).toBe(true);
  });
});
