/**
 * The machine a device runs on. Simulator code asks the machine to run
 * `simctl`, spawn the bridge, reach a stream port or find a bundled tool, and
 * stays the same whether that machine is this Mac or one behind SSH.
 */

import type { DeviceHostConfig } from "./config";
import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as net from "node:net";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";
import { resolveAssetPath } from "../tools/assets";
import {
  ProcessStream,
  runSsh,
  shellQuote,
  sshBaseArgs,
  sshExecArgs,
  sshSpawn,
  sshStreamArgs,
} from "./ssh";

const execFileAsync = promisify(execFile);

export type DeviceTool = "argus-sim-bridge" | "argus-sim-input";

export interface ExecOptions {
  timeoutMs?: number;
}

export interface DeviceMachine {
  /** Null for this Mac. */
  readonly hostId: string | null;
  /** Run to completion; rejects with an Error carrying stderr, like execFile. */
  exec: (
    file: string,
    args: string[],
    opts?: ExecOptions,
  ) => Promise<{ stderr: string; stdout: string }>;
  /** A long-lived process with piped stdio. */
  spawn: (file: string, args: string[]) => ChildProcessWithoutNullStreams;
  /** A byte stream to a loopback TCP port on that machine. */
  connect: (port: number) => Duplex;
  /** Absolute path of a bundled tool there, installing it first if needed. */
  toolPath: (tool: DeviceTool) => Promise<string>;
}

export const localMachine: DeviceMachine = {
  hostId: null,
  async exec(file, args, opts) {
    return execFileAsync(file, args, { timeout: opts?.timeoutMs ?? 0 });
  },
  spawn(file, args) {
    return spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
  },
  connect(port) {
    return net.connect(port, "127.0.0.1");
  },
  toolPath(tool) {
    return Promise.resolve(resolveAssetPath(tool));
  },
};

/** What a remote machine tells the registry so it can track health. */
export interface SshMachineHooks {
  /** Called before every connection so the multiplexing master is up. */
  ensureMaster: () => void;
  /** ssh itself failed (exit 255): the host is unreachable or refused us. */
  onSshFailure: (stderr: string) => void;
  onSuccess: () => void;
}

/** Exit status ssh uses for its own failures, as opposed to the command's. */
const SSH_FAILED = 255;

const REMOTE_BIN_DIR = ".argus/remote-bin";

/** Content hash of a bundled tool, so the remote copy is pinned to this build. */
function toolHash(localPath: string): string {
  const stat = fs.statSync(localPath);
  const key = `${localPath}:${String(stat.mtimeMs)}:${String(stat.size)}`;
  const cached = hashCache.get(key);
  if (cached) {
    return cached;
  }
  const hash = createHash("sha256")
    .update(fs.readFileSync(localPath))
    .digest("hex")
    .slice(0, 12);
  hashCache.set(key, hash);

  return hash;
}

const hashCache = new Map<string, string>();

export class SshMachine implements DeviceMachine {
  readonly hostId: string;
  private remoteHome: Promise<string> | null = null;
  private readonly installs = new Map<string, Promise<string>>();

  constructor(
    readonly config: DeviceHostConfig,
    private readonly hooks: SshMachineHooks,
  ) {
    this.hostId = config.id;
  }

  async exec(
    file: string,
    args: string[],
    opts?: ExecOptions,
  ): Promise<{ stderr: string; stdout: string }> {
    return this.run(sshExecArgs(this.config, file, args), opts?.timeoutMs);
  }

  spawn(file: string, args: string[]): ChildProcessWithoutNullStreams {
    this.hooks.ensureMaster();

    return sshSpawn(sshExecArgs(this.config, file, args));
  }

  connect(port: number): Duplex {
    this.hooks.ensureMaster();

    return new ProcessStream(sshSpawn(sshStreamArgs(this.config, port)));
  }

  toolPath(tool: DeviceTool): Promise<string> {
    const localPath = resolveAssetPath(tool);
    const remoteRel = `${REMOTE_BIN_DIR}/${toolHash(localPath)}/${tool}`;
    let install = this.installs.get(remoteRel);
    if (!install) {
      install = this.install(localPath, remoteRel);
      this.installs.set(remoteRel, install);
      // A failed install is retried next time rather than cached.
      install.catch(() => this.installs.delete(remoteRel));
    }

    return install;
  }

  /** Run a fixed script (no user input in it) through the remote shell. */
  private async run(
    args: string[],
    timeoutMs?: number,
    input?: Buffer,
  ): Promise<{ stderr: string; stdout: string }> {
    this.hooks.ensureMaster();
    const res = await runSsh(args, { input, timeoutMs });
    if (res.code === SSH_FAILED) {
      this.hooks.onSshFailure(res.stderr);
    } else if (res.code !== null) {
      this.hooks.onSuccess();
    }
    if (res.code !== 0) {
      throw new Error(
        `Command failed on ${this.config.label} (exit ${String(res.code)}): ${res.stderr.trim()}`,
      );
    }

    return { stdout: res.stdout, stderr: res.stderr };
  }

  private home(): Promise<string> {
    this.remoteHome ??= this.run([
      ...sshBaseArgs(this.config),
      'printf %s "$HOME"',
    ]).then(({ stdout }) => {
      const home = stdout.trim();
      if (!home.startsWith("/") || /[\n\0]/.test(home)) {
        throw new Error("Couldn't read the remote home directory");
      }

      return home;
    });
    this.remoteHome.catch(() => {
      this.remoteHome = null;
    });

    return this.remoteHome;
  }

  private async install(localPath: string, remoteRel: string): Promise<string> {
    const remotePath = `${await this.home()}/${remoteRel}`;
    try {
      await this.exec("test", ["-x", remotePath]);

      return remotePath;
    } catch {
      // Not there yet: upload below.
    }
    const dir = remotePath.slice(0, remotePath.lastIndexOf("/"));
    const partial = `${remotePath}.partial`;
    const script = [
      `mkdir -p ${shellQuote(dir)}`,
      `cat > ${shellQuote(partial)}`,
      `chmod 755 ${shellQuote(partial)}`,
      `mv -f ${shellQuote(partial)} ${shellQuote(remotePath)}`,
    ].join(" && ");
    await this.run(
      [...sshBaseArgs(this.config), script],
      120_000,
      fs.readFileSync(localPath),
    );

    return remotePath;
  }
}
