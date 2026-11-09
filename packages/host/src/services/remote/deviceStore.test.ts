/**
 * The device store holds the host's identity and every pairing. A store this
 * host can't read must stop the gateway, never be regenerated over.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeSecretStorage } from "../../lib/nodeSecretStorage";

/** Installs the platform on the fresh module graph `resetModules` leaves behind. */
async function installPlatform(encrypted: boolean): Promise<void> {
  const platform = await import("../../platform");
  platform.setHostPlatform(
    platform.nodeHostPlatform(
      encrypted ? { secretStorage: nodeSecretStorage("file") } : {},
    ),
  );
}

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
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("refuses an encrypted store it cannot decrypt instead of replacing it", async () => {
    await installPlatform(false);
    const file = path.join(home, "remote-devices.json");
    const sealed = Buffer.from("ah1sealed").toString("base64");
    const original = JSON.stringify({ enc: true, data: sealed });
    fs.writeFileSync(file, original);

    const { listDevices } = await import("./deviceStore");
    await expect(listDevices()).rejects.toThrow(/encrypted/);
    expect(fs.readFileSync(file, "utf-8")).toBe(original);
  });

  it("tells a host to open Electron once when the store is in safeStorage's format", async () => {
    await installPlatform(true);
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
    await installPlatform(true);
    const { getDesktopIdentity } = await import("./deviceStore");
    const identity = await getDesktopIdentity();
    expect(identity).toBeTruthy();
    expect(fs.existsSync(path.join(home, "remote-devices.json"))).toBe(true);
  });

  // The gateway, pairing and the account all ask at boot: two keys would pin
  // the phone to one while the gateway answers with the other.
  it("hands every concurrent first caller the same identity", async () => {
    await installPlatform(true);
    const { getDesktopIdentity, getHostKey, saveDevice } =
      await import("./deviceStore");
    const [a, b] = await Promise.all([getDesktopIdentity(), getHostKey()]);
    expect(Buffer.from(a.pub).toString("base64url")).toBe(b);

    await saveDevice({
      device_id: "d1",
      dev_static_pub: "k",
      label: "phone",
      capabilities: [],
      created_at: 0,
      last_seen: null,
    });
    vi.resetModules();
    await installPlatform(true);
    const reloaded = await import("./deviceStore");
    const again = await reloaded.getDesktopIdentity();
    expect(Buffer.from(again.pub).toString("base64url")).toBe(b);
    expect((await reloaded.listDevices()).map((d) => d.device_id)).toEqual([
      "d1",
    ]);
  });

  it("refuses to write the identity without secret storage", async () => {
    await installPlatform(false);
    const { getDesktopIdentity } = await import("./deviceStore");
    await expect(getDesktopIdentity()).rejects.toThrow(/secret storage/);
    expect(fs.existsSync(path.join(home, "remote-devices.json"))).toBe(false);
  });

  it("reads an older plaintext store and seals it in place", async () => {
    await installPlatform(true);
    const file = path.join(home, "remote-devices.json");
    const state = { ds_priv: "cHJpdg==", ds_pub: "cHVi", devices: {} };
    fs.writeFileSync(file, JSON.stringify({ enc: false, data: state }));

    const { getHostKey } = await import("./deviceStore");
    await expect(getHostKey()).resolves.toBe(
      Buffer.from("pub").toString("base64url"),
    );
    const written = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      enc: boolean;
    };
    expect(written.enc).toBe(true);
  });

  it("still reads a plaintext store when it cannot seal it", async () => {
    await installPlatform(false);
    const file = path.join(home, "remote-devices.json");
    const original = JSON.stringify({
      enc: false,
      data: { ds_priv: "cHJpdg==", ds_pub: "cHVi", devices: {} },
    });
    fs.writeFileSync(file, original);

    const { listDevices } = await import("./deviceStore");
    await expect(listDevices()).resolves.toEqual([]);
    expect(fs.readFileSync(file, "utf-8")).toBe(original);
  });
});
