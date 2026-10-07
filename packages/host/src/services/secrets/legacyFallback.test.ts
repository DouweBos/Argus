/**
 * A move off `safeStorage` that fails must cost the Electron app nothing: the
 * files stay byte for byte, its stores keep reading (and writing) the old
 * format, the Mac app still sees them as old, and the next launch retries.
 */

import type { SecretStorage } from "../../platform";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeSecretStorage } from "../../lib/nodeSecretStorage";

/** A `safeStorage` stand-in: `v10` + reversed bytes. */
const safeStorage: SecretStorage = {
  isAvailable: () => true,
  encrypt: (s) =>
    Buffer.concat([Buffer.from("v10"), Buffer.from(s, "utf8").reverse()]),
  decrypt: (blob) => {
    if (!blob.subarray(0, 3).equals(Buffer.from("v10"))) {
      throw new Error("Error while decrypting the ciphertext provided");
    }

    return Buffer.from(blob.subarray(3)).reverse().toString("utf8");
  },
};

const seal = (value: unknown) =>
  safeStorage.encrypt(JSON.stringify(value)).toString("base64");

const MCP_URL = "https://mcp.example/mcp";
const device = {
  device_id: "d1",
  label: "Phone",
  dev_static_pub: "cHVi",
  capabilities: ["monitor"],
  created_at: 1,
  last_seen: null,
};
const token = {
  resource: MCP_URL,
  accessToken: "access",
  tokenEndpoint: "https://mcp.example/token",
  authorizationEndpoint: "https://mcp.example/auth",
  clientId: "c",
};

/** The shared scheme with its keychain unreachable. */
const keychainDown: SecretStorage = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error("secret storage is unavailable");
  },
  decrypt: () => {
    throw new Error("secret storage is unavailable");
  },
};

/** The keychain answers, then refuses mid-way (a locked or denied item). */
const keychainRefusesWrites: SecretStorage = {
  isAvailable: () => true,
  encrypt: () => {
    throw new Error("User interaction is not allowed.");
  },
  decrypt: () => {
    throw new Error("User interaction is not allowed.");
  },
};

/** Seals fine, but the rewritten file never reads back. */
function verifyFails(): SecretStorage {
  const real = nodeSecretStorage("file");
  let decrypts = 0;

  return {
    ...real,
    decrypt: (blob) => {
      decrypts += 1;
      if (decrypts > 1) {
        throw new Error("disk says no");
      }

      return real.decrypt(blob);
    },
  };
}

describe("a failed move off safeStorage", () => {
  let home: string;
  const devicesFile = () => path.join(home, "remote-devices.json");
  const tokensFile = () => path.join(home, "mcp-tokens.json");

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-fallback-"));
    vi.stubEnv("ARGUS_HOME", home);
    fs.writeFileSync(
      devicesFile(),
      JSON.stringify({
        enc: true,
        data: seal({
          ds_priv: "cHJpdg==",
          ds_pub: "cHVi",
          devices: { d1: device },
        }),
      }),
    );
    fs.writeFileSync(
      tokensFile(),
      JSON.stringify({
        servers: { [MCP_URL]: { enc: true, data: seal(token) } },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** One Electron launch: its platform, the boot migration, its stores. */
  async function launch(current: () => SecretStorage) {
    vi.resetModules();
    const platform = await import("../../platform");
    platform.setHostPlatform(
      platform.nodeHostPlatform({
        secretStorage: current(),
        legacySecretStorage: safeStorage,
      }),
    );
    const stores = await import("./legacyStores");
    const results = stores.migrateLegacySecretStores(
      safeStorage,
      platform.hostPlatform().secretStorage,
    );

    return {
      results,
      stores,
      devices: await import("../remote/deviceStore"),
      tokens: await import("../mcp/oauthStore"),
    };
  }

  const snapshot = () => [
    fs.readFileSync(devicesFile(), "utf8"),
    fs.readFileSync(tokensFile(), "utf8"),
  ];

  it.each([
    ["the keychain is unreachable", () => keychainDown],
    ["the keychain refuses", () => keychainRefusesWrites],
    ["the rewrite doesn't verify", verifyFails],
  ])(
    "leaves the files alone and keeps reading them when %s",
    async (_, current) => {
      const before = snapshot();

      const run = await launch(current);

      expect(run.results.map((r) => r.outcome)).toEqual(["failed", "failed"]);
      expect(snapshot()).toEqual(before);
      expect(fs.readdirSync(home).filter((f) => f.includes("backup"))).toEqual(
        [],
      );
      expect((await run.devices.listDevices()).map((d) => d.label)).toEqual([
        "Phone",
      ]);
      expect((await run.tokens.loadToken(MCP_URL))?.accessToken).toBe("access");
      // The Mac app still sees old-format stores and keeps its card up.
      expect(run.stores.findLegacySecretStores().sort()).toEqual([
        "mcp_tokens",
        "remote_devices",
      ]);
    },
  );

  it("writes the old format while it can't move, then moves on the next launch", async () => {
    const failed = await launch(() => keychainRefusesWrites);
    await failed.devices.renameDevice("d1", "Renamed");
    await failed.tokens.saveToken({ ...token, resource: "https://b.example" });

    const blobs = [
      JSON.parse(fs.readFileSync(devicesFile(), "utf8")).data,
      ...Object.values(
        JSON.parse(fs.readFileSync(tokensFile(), "utf8")).servers as Record<
          string,
          { data: string }
        >,
      ).map((e) => e.data),
    ];
    for (const blob of blobs) {
      expect(Buffer.from(blob, "base64").subarray(0, 3).toString()).toBe("v10");
    }

    const next = await launch(() => nodeSecretStorage("file"));

    expect(next.results.map((r) => r.outcome)).toEqual([
      "migrated",
      "migrated",
    ]);
    expect(next.stores.findLegacySecretStores()).toEqual([]);
    expect((await next.devices.listDevices()).map((d) => d.label)).toEqual([
      "Renamed",
    ]);
    expect(
      (await next.tokens.loadToken("https://b.example"))?.accessToken,
    ).toBe("access");
  });

  it("tells a host without safeStorage to open Electron", async () => {
    vi.resetModules();
    const platform = await import("../../platform");
    platform.setHostPlatform(
      platform.nodeHostPlatform({ secretStorage: nodeSecretStorage("file") }),
    );
    const { listDevices } = await import("../remote/deviceStore");
    const { loadToken } = await import("../mcp/oauthStore");

    await expect(listDevices()).rejects.toThrow(/Open the Argus Electron app/);
    await expect(loadToken(MCP_URL)).resolves.toBeNull();
  });
});
