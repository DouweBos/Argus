import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeSecretStorage } from "./nodeSecretStorage";

describe("node secret storage", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-secrets-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    process.env.ARGUS_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("round-trips through a key it mints on first use", () => {
    const storage = nodeSecretStorage("file");
    expect(storage.isAvailable()).toBe(true);
    const blob = storage.encrypt("hunter2");
    expect(blob.toString("utf8")).not.toContain("hunter2");
    expect(storage.decrypt(blob)).toBe("hunter2");
    const keyFile = path.join(home, "secret-storage.key");
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
  });

  it("reuses the stored key across instances", () => {
    const blob = nodeSecretStorage("file").encrypt("again");
    expect(nodeSecretStorage("file").decrypt(blob)).toBe("again");
  });

  it("refuses a blob it did not write", () => {
    expect(() =>
      nodeSecretStorage("file").decrypt(Buffer.from("v10garbage")),
    ).toThrow(/not written/);
  });

  it("refuses a tampered blob", () => {
    const blob = nodeSecretStorage("file").encrypt("payload");
    blob[blob.length - 1] ^= 1;
    expect(() => nodeSecretStorage("file").decrypt(blob)).toThrow();
  });
});

describe("node secret storage in the keychain", () => {
  let dir: string;
  let prevHome: string | undefined;
  let prevArgusHome: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-keychain-"));
    prevHome = process.env.HOME;
    prevArgusHome = process.env.ARGUS_HOME;
    // A scratch HOME has no default keychain; that's what used to hang.
    process.env.HOME = dir;
    process.env.ARGUS_HOME = dir;
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    process.env.ARGUS_HOME = prevArgusHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A `security` stand-in: logs its argv and stdin, hangs when told to. */
  function fakeSecurity(script: string): string {
    const bin = path.join(dir, "security");
    fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

    return bin;
  }

  it("gives up on a security call that never returns", () => {
    const command = fakeSecurity("sleep 30");
    const started = Date.now();
    const storage = nodeSecretStorage("keychain", { command, timeoutMs: 300 });

    expect(storage.isAvailable()).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.runIf(process.platform === "darwin")(
    "names the login keychain, which a different HOME can't find",
    () => {
      const log = path.join(dir, "calls.log");
      const command = fakeSecurity(`echo "$@" >> "${log}"; cat >> "${log}"`);
      nodeSecretStorage("keychain", { command, timeoutMs: 2000 }).isAvailable();

      const keychain = path.join(
        os.userInfo().homedir,
        "Library/Keychains/login.keychain-db",
      );
      const calls = fs.readFileSync(log, "utf8");
      expect(calls).toContain(`-w ${keychain}`);
      expect(calls).toContain(`"${keychain}"`);
    },
  );
});
