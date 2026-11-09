/**
 * The legacy tunnels' child processes, driven with a fake `cloudflared`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTunnelState,
  killTunnelsNow,
  startTunnel,
  stopTunnel,
} from "./tunnelManager";

let dir: string;
let log: string;

/** A shell script standing in for cloudflared; `body` runs after logging. */
function fakeBinary(body: string): string {
  const bin = path.join(dir, "cloudflared");
  fs.writeFileSync(
    bin,
    `#!/bin/sh\necho "$TUNNEL_TOKEN|$*" >> "${log}"\n${body}\n`,
    { mode: 0o755 },
  );

  return bin;
}

const REGISTERS = `echo "INF Registered tunnel connection connIndex=0" >&2\nexec sleep 30`;

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

describe("tunnel manager", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-tunnel-"));
    log = path.join(dir, "launches.log");
  });

  afterEach(() => {
    stopTunnel();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A host on its way out can't wait for an escalation timer.
  it("kills a tunnel that ignores SIGTERM at once on a hard exit", async () => {
    const pidFile = path.join(dir, "pid");
    startTunnel({
      provider: "cloudflare",
      cloudflareMode: "token",
      cloudflareToken: "tok",
      localPort: 1,
      bin: fakeBinary(`trap '' TERM\necho $$ > "${pidFile}"\n${REGISTERS}`),
    });
    await until(() => getTunnelState("cloudflare").status === "running");
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));

    killTunnelsNow();

    await until(() => !isAlive(pid), 1000);
    expect(getTunnelState("cloudflare").status).toBe("stopped");
  });

  it("hands a named tunnel its token in the environment, never argv", async () => {
    startTunnel({
      provider: "cloudflare",
      cloudflareMode: "token",
      cloudflareToken: "secret-token",
      localPort: 1,
      bin: fakeBinary(REGISTERS),
    });
    await until(() => fs.existsSync(log));

    expect(fs.readFileSync(log, "utf-8").trim()).toBe(
      "secret-token|tunnel run",
    );
  });
});
