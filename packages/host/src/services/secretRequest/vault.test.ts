import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_TTL_MS,
  resetVaultForTests,
  runSecretEnv,
  setRunSecretEnv,
  setSecretsRootForTests,
  sweepExpiredSecretFiles,
  writeSecretFile,
} from "./vault";

let root: string;
let vault: string;

describe("secret vault", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
    vault = path.join(root, "vault");
    setSecretsRootForTests(vault);
  });

  afterEach(() => {
    resetVaultForTests();
    setSecretsRootForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sweeps files past their expiry, or named past the cap", () => {
    const now = 1_000_000;
    const kept = writeSecretFile("a", "x", 60_000, now);
    const stale = writeSecretFile("b", "y", 60_000, now - 120_000);
    fs.writeFileSync(path.join(vault, "junk"), "z");
    fs.writeFileSync(path.join(vault, `c.${now + MAX_TTL_MS * 2}.ff`), "z");

    expect(sweepExpiredSecretFiles(now)).toBe(3);
    expect(fs.existsSync(kept.path)).toBe(true);
    expect(fs.existsSync(stale.path)).toBe(false);
  });

  it("refuses a vault that is a symlink", () => {
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, vault);
    expect(() => writeSecretFile("a", "x", 60_000)).toThrow();
  });

  it("drops run env once it expires", () => {
    setRunSecretEnv("s", "Dev", "TOKEN", "v", 1000, 0);
    expect(runSecretEnv("s", "Dev", 500)).toEqual({ TOKEN: "v" });
    expect(runSecretEnv("s", "Dev", 1500)).toEqual({});
    expect(runSecretEnv("s", "Other", 0)).toEqual({});
  });
});
