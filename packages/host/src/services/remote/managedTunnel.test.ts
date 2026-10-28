/**
 * The managed tunnel's connector supervisor, driven with a fake `cloudflared`:
 * the token travels in the environment, a registered connection means up,
 * and a dead connector restarts and says whether its credentials were refused.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tunnelManager", () => ({ notifyTunnelChange: () => {} }));

const {
  getManagedTunnelState,
  getManagedTunnelUrl,
  runningToken,
  startManagedTunnel,
  stopManagedTunnel,
} = await import("./managedTunnel");

const URL = "wss://argus-0123456789abcdef.houwert.dev";

let dir: string;
let log: string;

/** A shell script standing in for cloudflared; `body` runs after logging. */
function fakeBinary(body: string): string {
  const bin = path.join(
    dir,
    `cloudflared-${Math.random().toString(36).slice(2)}`,
  );
  fs.writeFileSync(
    bin,
    `#!/bin/sh\necho "$TUNNEL_TOKEN|$*" >> "${log}"\n${body}\n`,
    { mode: 0o755 },
  );

  return bin;
}

const REGISTERS = `echo "INF Registered tunnel connection connIndex=0 location=ams01" >&2\nexec sleep 30`;

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function launches(): string[] {
  return fs.existsSync(log)
    ? fs.readFileSync(log, "utf-8").trim().split("\n").filter(Boolean)
    : [];
}

describe("managed tunnel supervisor", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-cfd-"));
    log = path.join(dir, "launches.log");
  });

  afterEach(() => {
    stopManagedTunnel();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs with the token in the environment and goes up on registration", async () => {
    const onRegistered = vi.fn();
    startManagedTunnel(
      { bin: fakeBinary(REGISTERS), token: "tok-1", url: URL },
      { onRegistered },
    );
    expect(getManagedTunnelState().phase).toBe("starting");
    expect(getManagedTunnelUrl()).toBeNull();

    await until(() => getManagedTunnelState().phase === "running");

    expect(getManagedTunnelUrl()).toBe(URL);
    expect(onRegistered).toHaveBeenCalledOnce();
    expect(runningToken()).toBe("tok-1");
    // Never on argv, where `ps` would show it.
    expect(launches()).toEqual(["tok-1|tunnel --no-autoupdate run"]);
  });

  it("restarts a connector that dies, with backoff", async () => {
    const onExit = vi.fn();
    startManagedTunnel(
      { bin: fakeBinary("exit 1"), token: "tok-1", url: URL },
      { onExit, backoffMs: [10, 20] },
    );

    await until(() => launches().length >= 3);

    expect(onExit.mock.calls[0][0]).toEqual({ failures: 1, rejected: false });
    expect(onExit.mock.calls[1][0]).toEqual({ failures: 2, rejected: false });
    expect(getManagedTunnelUrl()).toBeNull();
  });

  it("says when the edge refused the credentials", async () => {
    const onExit = vi.fn();
    startManagedTunnel(
      {
        bin: fakeBinary(
          `echo "ERR Unauthorized: Invalid tunnel secret" >&2\nexit 1`,
        ),
        token: "stale",
        url: URL,
      },
      { onExit, backoffMs: [60_000] },
    );

    await until(() => onExit.mock.calls.length === 1);

    expect(onExit.mock.calls[0][0]).toEqual({ failures: 1, rejected: true });
    expect(getManagedTunnelState()).toMatchObject({
      phase: "error",
      error: expect.stringContaining("Unauthorized"),
    });
  });

  it("swaps credentials by restarting the one connector", async () => {
    startManagedTunnel({ bin: fakeBinary(REGISTERS), token: "old", url: URL });
    await until(() => getManagedTunnelState().phase === "running");

    startManagedTunnel({ bin: fakeBinary(REGISTERS), token: "new", url: URL });
    await until(() => launches().length === 2);
    await until(() => getManagedTunnelState().phase === "running");

    expect(runningToken()).toBe("new");
    expect(launches().map((l) => l.split("|")[0])).toEqual(["old", "new"]);
  });

  it("stops without restarting", async () => {
    const onExit = vi.fn();
    startManagedTunnel(
      { bin: fakeBinary(REGISTERS), token: "tok", url: URL },
      { onExit, backoffMs: [10] },
    );
    await until(() => getManagedTunnelState().phase === "running");

    stopManagedTunnel();
    await new Promise((r) => setTimeout(r, 100));

    expect(onExit).not.toHaveBeenCalled();
    expect(runningToken()).toBeNull();
    expect(launches()).toHaveLength(1);
  });

  it("reports a binary that can't be launched", async () => {
    const onExit = vi.fn();
    startManagedTunnel(
      { bin: path.join(dir, "missing"), token: "tok", url: URL },
      { onExit, backoffMs: [60_000] },
    );

    await until(() => onExit.mock.calls.length === 1);

    expect(getManagedTunnelState().error).toMatch(/couldn't start cloudflared/);
  });
});
