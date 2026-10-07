/**
 * Moving stores off Electron's `safeStorage`: every readable blob is re-sealed,
 * nothing unreadable is ever dropped, and a second run changes nothing.
 */

import type { SecretStorage } from "../../platform";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeSecretStorage } from "../../lib/nodeSecretStorage";
import {
  findLegacySecretStores,
  migrateLegacySecretStores,
  secretStoreBackupPath,
} from "./legacyStores";

/** A `safeStorage` stand-in: `v10` + reversed bytes, like a real one is opaque. */
function fakeSafeStorage(): SecretStorage & {
  seal: (s: string) => string;
} {
  return {
    isAvailable: () => true,
    encrypt: (s) =>
      Buffer.concat([Buffer.from("v10"), Buffer.from(s, "utf8").reverse()]),
    seal: (s) =>
      Buffer.concat([
        Buffer.from("v10"),
        Buffer.from(s, "utf8").reverse(),
      ]).toString("base64"),
    decrypt: (blob) => {
      if (!blob.subarray(0, 3).equals(Buffer.from("v10"))) {
        throw new Error("Error while decrypting the ciphertext provided");
      }

      return Buffer.from(blob.subarray(3)).reverse().toString("utf8");
    },
  };
}

describe("legacy secret store migration", () => {
  let home: string;
  const legacy = fakeSafeStorage();
  let current: SecretStorage;

  const devicesFile = () => path.join(home, "remote-devices.json");
  const tokensFile = () => path.join(home, "mcp-tokens.json");
  const devices = { ds_priv: "priv", ds_pub: "pub", devices: { a: {} } };
  const token = { resource: "https://mcp.example", accessToken: "t" };

  function writeLegacyStores(): void {
    fs.writeFileSync(
      devicesFile(),
      JSON.stringify({ enc: true, data: legacy.seal(JSON.stringify(devices)) }),
    );
    fs.writeFileSync(
      tokensFile(),
      JSON.stringify({
        servers: {
          "https://mcp.example": {
            enc: true,
            data: legacy.seal(JSON.stringify(token)),
          },
          "https://plain.example": { enc: false, data: { accessToken: "p" } },
        },
      }),
    );
  }

  function readBlob(file: string, pick: (j: never) => string): string {
    const blob = pick(JSON.parse(fs.readFileSync(file, "utf8")) as never);

    return current.decrypt(Buffer.from(blob, "base64"));
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-migrate-"));
    vi.stubEnv("ARGUS_HOME", home);
    current = nodeSecretStorage("file");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("re-seals both stores and leaves no backup", () => {
    writeLegacyStores();
    expect(findLegacySecretStores().sort()).toEqual([
      "mcp_tokens",
      "remote_devices",
    ]);

    const results = migrateLegacySecretStores(legacy, current);

    expect(results).toEqual([
      { store: "remote_devices", outcome: "migrated" },
      { store: "mcp_tokens", outcome: "migrated" },
    ]);
    expect(
      JSON.parse(readBlob(devicesFile(), (j: { data: string }) => j.data)),
    ).toEqual(devices);
    expect(
      JSON.parse(
        readBlob(
          tokensFile(),
          (j: { servers: Record<string, { data: string }> }) =>
            j.servers["https://mcp.example"].data,
        ),
      ),
    ).toEqual(token);
    const tokens = JSON.parse(fs.readFileSync(tokensFile(), "utf8"));
    expect(tokens.servers["https://plain.example"]).toEqual({
      enc: false,
      data: { accessToken: "p" },
    });
    expect(fs.statSync(devicesFile()).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(secretStoreBackupPath("remote_devices"))).toBe(false);
    expect(findLegacySecretStores()).toEqual([]);
  });

  it("is idempotent", () => {
    writeLegacyStores();
    migrateLegacySecretStores(legacy, current);
    const before = fs.readFileSync(devicesFile(), "utf8");

    expect(migrateLegacySecretStores(legacy, current)).toEqual([
      { store: "remote_devices", outcome: "already" },
      { store: "mcp_tokens", outcome: "already" },
    ]);
    expect(fs.readFileSync(devicesFile(), "utf8")).toBe(before);
  });

  it("reports nothing for a home without stores", () => {
    expect(migrateLegacySecretStores(legacy, current)).toEqual([]);
  });

  it("never touches a store it can't read", () => {
    const original = JSON.stringify({ enc: true, data: "djEwZ2FyYmFnZQ==" });
    fs.writeFileSync(devicesFile(), original);
    const broken = {
      ...legacy,
      decrypt: (): string => {
        throw new Error("key mismatch");
      },
    };

    const [result] = migrateLegacySecretStores(broken, current);

    expect(result).toMatchObject({
      store: "remote_devices",
      outcome: "failed",
    });
    expect(fs.readFileSync(devicesFile(), "utf8")).toBe(original);
  });

  it("leaves the whole store as it was when one token can't be read", () => {
    writeLegacyStores();
    const tokens = JSON.parse(fs.readFileSync(tokensFile(), "utf8"));
    tokens.servers["https://other.example"] = {
      enc: true,
      data: "djEwAAAA",
    };
    fs.writeFileSync(tokensFile(), JSON.stringify(tokens));
    const before = fs.readFileSync(tokensFile(), "utf8");
    const picky = {
      ...legacy,
      decrypt: (blob: Buffer) => {
        if (blob.toString("base64") === "djEwAAAA") {
          throw new Error("key mismatch");
        }

        return legacy.decrypt(blob);
      },
    };

    const results = migrateLegacySecretStores(picky, current);

    expect(results[1]).toMatchObject({
      store: "mcp_tokens",
      outcome: "failed",
    });
    expect(fs.readFileSync(tokensFile(), "utf8")).toBe(before);
  });

  it("does nothing without a way to read the old blobs", () => {
    writeLegacyStores();
    const before = fs.readFileSync(devicesFile(), "utf8");

    expect(migrateLegacySecretStores(undefined, current)[0]).toMatchObject({
      outcome: "failed",
    });
    expect(fs.readFileSync(devicesFile(), "utf8")).toBe(before);
  });

  it("puts the original back when the rewrite doesn't read back", () => {
    writeLegacyStores();
    const before = fs.readFileSync(devicesFile(), "utf8");
    let calls = 0;
    const flaky: SecretStorage = {
      ...current,
      // The in-memory check passes; reading the written file back fails.
      decrypt: (blob) => {
        calls += 1;
        if (calls > 1) {
          throw new Error("disk says no");
        }

        return current.decrypt(blob);
      },
    };

    const [result] = migrateLegacySecretStores(legacy, flaky);

    expect(result).toMatchObject({
      store: "remote_devices",
      outcome: "failed",
    });
    expect(fs.readFileSync(devicesFile(), "utf8")).toBe(before);
    expect(fs.existsSync(secretStoreBackupPath("remote_devices"))).toBe(false);
  });
});
