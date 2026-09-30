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
