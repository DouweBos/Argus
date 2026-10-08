import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireHostLock,
  advertiseHostSocket,
  hostLockPath,
  readHostLock,
  releaseHostLock,
  waitForHostLockRelease,
} from "./hostLock";

describe("host lock", () => {
  let home: string;
  let child: ChildProcess | null = null;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-lock-"));
  });

  afterEach(() => {
    child?.kill("SIGKILL");
    child = null;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function writeLockFor(pid: number, ownerPid = pid): void {
    fs.writeFileSync(
      hostLockPath(home),
      JSON.stringify({ pid, owner_pid: ownerPid, owner: "mac", started_at: 1 }),
    );
  }

  it("takes a free lock with mode 0600 and releases it", () => {
    const result = acquireHostLock("cli", { home });
    expect(result.ok).toBe(true);
    expect(fs.statSync(hostLockPath(home)).mode & 0o777).toBe(0o600);
    expect(readHostLock(home)?.pid).toBe(process.pid);
    if (result.ok) {
      result.release();
    }
    expect(fs.existsSync(hostLockPath(home))).toBe(false);
  });

  it("blocks a second host while the holder is alive", () => {
    child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
    writeLockFor(child.pid!, 4242);

    expect(acquireHostLock("electron", { home })).toMatchObject({
      ok: false,
      holder: { pid: child.pid, owner_pid: 4242, owner: "mac" },
    });
  });

  it("reclaims a lock left by a process that is gone", async () => {
    child = spawn(process.execPath, ["-e", ""]);
    const pid = child.pid!;
    await new Promise((resolve) => child!.on("exit", resolve));
    writeLockFor(pid);

    expect(readHostLock(home)).toBeNull();
    expect(acquireHostLock("cli", { home }).ok).toBe(true);
    expect(readHostLock(home)?.pid).toBe(process.pid);
  });

  it("never removes a lock someone else holds", () => {
    child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
    writeLockFor(child.pid!);
    releaseHostLock(home);
    expect(readHostLock(home)?.pid).toBe(child.pid);
  });

  it("waits for the holder to go away", async () => {
    child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
    writeLockFor(child.pid!);
    await expect(waitForHostLockRelease(50, home)).resolves.toBe(false);
    await expect(waitForHostLockRelease(5000, home)).resolves.toBe(true);
  });

  it("advertises the UI socket only in a lock it holds", () => {
    const result = acquireHostLock("electron", { home });
    expect(result.ok).toBe(true);
    expect(advertiseHostSocket("/x/host.sock", 1, home)).toBe(true);
    expect(readHostLock(home)).toMatchObject({
      pid: process.pid,
      owner: "electron",
      socket: "/x/host.sock",
      protocol: 1,
    });
    expect(fs.statSync(hostLockPath(home)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(home)).toEqual(["host.lock"]);

    writeLockFor(process.pid + 1_000_000);
    expect(advertiseHostSocket("/x/host.sock", 1, home)).toBe(false);
  });
});
