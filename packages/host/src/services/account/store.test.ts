/**
 * An account record written before a setting existed reads back with that
 * setting's default, so upgrading never turns a feature off by accident.
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

describe("account record", () => {
  let home: string;
  const prev = process.env.ARGUS_HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-store-"));
    process.env.ARGUS_HOME = home;
    vi.resetModules();
    setHostPlatform(nodeHostPlatform());
  });

  afterEach(() => {
    process.env.ARGUS_HOME = prev;
    resetHostPlatform();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("turns the managed tunnel on for a record from before it existed", async () => {
    const store = await import("./store");
    const deviceStore = await import("../remote/deviceStore");
    const record = await store.ensureAccountRecord();
    const { tunnel: _dropped, ...older } = record.config;
    await deviceStore.saveAccountRecord({
      ...record,
      config: { ...older, enabled: false } as typeof record.config,
    });

    const read = await store.readAccountRecord();

    expect(read?.config.tunnel).toBe(true);
    expect(read?.config.enabled).toBe(false);
    expect(read?.tunnel).toBeUndefined();
  });
});
