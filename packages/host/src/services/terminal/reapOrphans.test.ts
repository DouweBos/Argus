import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPty, recordPty, takePtyLedger } from "./ptyLedger";
import { orphanedHelpers } from "./reapOrphans";

const HELPER =
  "/Applications/Argus.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper";

describe("orphaned spawn-helpers", () => {
  const ps = [
    `  101     1 ${HELPER}`,
    `  202     1 ${HELPER}`,
    `  303   900 ${HELPER}`,
    "  404     1 /bin/zsh -l",
  ].join("\n");

  it("reaps only the helpers this host started", () => {
    // 202 is another Argus's orphan; 303 is still parented; 404 is a recycled pid.
    expect(orphanedHelpers(ps, new Set([101, 303, 404]))).toEqual([101]);
  });
});

describe("pty ledger", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-pty-"));
    vi.stubEnv("ARGUS_HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("keeps the live PTYs for the next boot and starts it empty", () => {
    recordPty(11);
    recordPty(12);
    forgetPty(11);

    expect(takePtyLedger()).toEqual([12]);
    expect(takePtyLedger()).toEqual([]);
  });

  it("is per ARGUS_HOME", () => {
    recordPty(21);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "argus-pty-"));
    vi.stubEnv("ARGUS_HOME", other);
    try {
      expect(takePtyLedger()).toEqual([]);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
