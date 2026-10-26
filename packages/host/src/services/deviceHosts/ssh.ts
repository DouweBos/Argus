/**
 * The SSH layer under device hosts: argv building, quoting, failure triage and
 * the process seam tests swap out. Everything goes through `spawn` with an arg
 * array; the one string a remote shell parses is built from {@link shellQuote}d
 * words.
 */

import type { DeviceHostConfig } from "./config";
import type { DeviceHostFailure } from "@argus/remote-protocol";
import {
  type ChildProcessWithoutNullStreams,
  spawn as nodeSpawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import { argusHomeDir } from "../../lib/argusHome";

/** Spawns a process; swapped for a fake in tests. */
export type SpawnFn = (
  file: string,
  args: string[],
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnFn = (file, args) =>
  nodeSpawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });

let spawnImpl = defaultSpawn;

export function setSshSpawnForTests(fn: SpawnFn | null): void {
  spawnImpl = fn ?? defaultSpawn;
}

export function sshSpawn(args: string[]): ChildProcessWithoutNullStreams {
  return spawnImpl("ssh", args);
}

/** Quote one word for a POSIX shell. */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(word)) {
    return word;
  }

  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export function remoteCommand(file: string, args: string[]): string {
  return [file, ...args].map(shellQuote).join(" ");
}

/**
 * ControlMaster sockets: a short dir (sun_path is 104 bytes on macOS) that only
 * this user can reach. `%C` hashes host+port+user, so it stays short too.
 */
function controlDir(): string {
  const preferred = path.join(argusHomeDir(), "ssh");
  const dir =
    preferred.length <= 60
      ? preferred
      : path.join(
          os.tmpdir(),
          `argus-ssh-${createHash("sha1").update(preferred).digest("hex").slice(0, 8)}`,
        );
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  return dir;
}

export function controlPath(): string {
  return path.join(controlDir(), "%C");
}

/**
 * Options every ssh call for this host shares, ending with `-- <target>`.
 * Clients ride the master's socket when it's up and connect directly when it
 * isn't, so a dropped master never blocks a call.
 */
export function sshBaseArgs(
  host: DeviceHostConfig,
  role: "client" | "master" = "client",
): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    `ControlMaster=${role === "master" ? "yes" : "no"}`,
    "-o",
    `ControlPath=${controlPath()}`,
  ];
  if (role === "master") {
    args.push("-o", "ControlPersist=no", "-N");
  }
  if (host.port !== null) {
    args.push("-p", String(host.port));
  }
  if (host.identityFile) {
    args.push("-i", host.identityFile, "-o", "IdentitiesOnly=yes");
  }
  args.push("--", host.target);

  return args;
}

/** Argv to run one command on the host. */
export function sshExecArgs(
  host: DeviceHostConfig,
  file: string,
  args: string[],
): string[] {
  return [...sshBaseArgs(host), remoteCommand(file, args)];
}

/** Argv for a byte stream to a loopback port on the host (`ssh -W`). */
export function sshStreamArgs(host: DeviceHostConfig, port: number): string[] {
  const base = sshBaseArgs(host);

  return [
    ...base.slice(0, -2),
    "-W",
    `127.0.0.1:${String(port)}`,
    ...base.slice(-2),
  ];
}

/** Argv for the long-lived multiplexing master Argus keeps per host. */
export function sshMasterArgs(host: DeviceHostConfig): string[] {
  return sshBaseArgs(host, "master");
}

export interface SshResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

/** Run ssh to completion, optionally feeding stdin. */
export function runSsh(
  args: string[],
  opts: { input?: Buffer; timeoutMs?: number } = {},
): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const child = sshSpawn(args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill(), opts.timeoutMs)
      : null;
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input);
  });
}

/** Sort ssh's own stderr into a failure kind. Exit 255 means ssh itself failed. */
export function classifySshFailure(stderr: string): DeviceHostFailure {
  const s = stderr.toLowerCase();
  if (
    s.includes("host key verification failed") ||
    s.includes("remote host identification has changed")
  ) {
    return "host_key";
  }
  if (
    s.includes("permission denied") ||
    s.includes("too many authentication failures")
  ) {
    return "auth";
  }
  if (s.includes("timed out")) {
    return "timeout";
  }
  if (
    s.includes("could not resolve hostname") ||
    s.includes("connection refused") ||
    s.includes("no route to host") ||
    s.includes("network is unreachable") ||
    s.includes("connection closed") ||
    s.includes("connection reset")
  ) {
    return "unreachable";
  }

  return "unknown";
}

export const FAILURE_MESSAGES: Record<DeviceHostFailure, string> = {
  auth: "SSH refused the login. Argus never prompts for passwords, so the key has to work with BatchMode (add it to ssh-agent or set an identity file).",
  host_key:
    "The host's SSH key doesn't match the one in known_hosts. Check it with ssh in a terminal first.",
  invalid_config: "The SSH settings aren't valid.",
  no_xcode:
    "Xcode isn't usable on that Mac (xcrun simctl failed). Install Xcode and run it once.",
  not_macos: "That machine isn't a Mac, so it can't run iOS simulators.",
  timeout: "The SSH connection timed out.",
  unknown: "SSH failed.",
  unreachable: "Couldn't reach the host over SSH.",
  unsupported_arch:
    "That Mac isn't Apple silicon; Argus's simulator bridge only runs on arm64.",
};

/**
 * A spawned process's stdio as one Duplex, so a `ssh -W` stream reads like a
 * socket. Destroying it kills the process.
 */
export class ProcessStream extends Duplex {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
    child.stdout.on("data", (chunk: Buffer) => {
      if (!this.push(chunk)) {
        child.stdout.pause();
      }
    });
    child.stdout.on("end", () => this.push(null));
    child.on("error", (e) => this.destroy(e));
    child.on("close", () => this.destroy());
    child.stdin.on("error", () => {});
  }

  override _read(): void {
    this.child.stdout.resume();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.child.stdin.write(chunk, callback);
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.child.exitCode === null) {
      this.child.kill();
    }
    callback(error);
  }
}
