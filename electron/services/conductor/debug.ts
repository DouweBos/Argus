/**
 * Debug panel backend — long-running conductor subprocesses and one-shot probes.
 *
 * The Debug toolrail panel exposes two kinds of tools:
 *
 * - **Stream tools** (e.g. `conductor logs`) spawn a long-lived subprocess.
 *   stdout/stderr lines are forwarded to the renderer as
 *   `debug:data:{streamId}` events; the stream ends with `debug:exit:{streamId}`.
 * - **One-shot tools** (e.g. `conductor memory`) run a single conductor
 *   invocation and return its stdout. The renderer polls on an interval
 *   when the user wants periodic sampling.
 *
 * All invocations still flow through `execConductor` / `conductorLogStore`
 * for stream starts so they appear in the device log; the streaming
 * subprocess itself bypasses that wrapper because it never terminates
 * normally.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { emitHostEvent } from "@argus/host/bus";
import { createLogger } from "../../../app/lib/logger";
import { getConductorBinPath } from "../cli/conductor";
import { conductorLogStore, execConductor } from "./logger";

const log = createLogger("conductor:debug");

interface DebugStream {
  streamId: string;
  deviceKey: string;
  command: string;
  proc: ChildProcess;
}

const streams = new Map<string, DebugStream>();

function send(event: string, payload: unknown): void {
  emitHostEvent(event, payload);
}

function ensureDeviceFlag(deviceKey: string, args: string[]): string[] {
  return args.some((a) => a === "--device" || a === "-d")
    ? args
    : [...args, "--device", deviceKey];
}

export interface StartDebugStreamInput {
  streamId: string;
  deviceKey: string;
  args: string[];
}

export function startDebugStream(input: StartDebugStreamInput): void {
  const { streamId, deviceKey, args } = input;
  if (streams.has(streamId)) {
    throw `Debug stream already running: ${streamId}`;
  }
  const finalArgs = ensureDeviceFlag(deviceKey, args);
  const bin = getConductorBinPath();
  log.info(
    `starting debug stream ${streamId}: conductor ${finalArgs.join(" ")}`,
  );

  // `detached: true` puts the child in its own process group so we can
  // signal the whole tree on stop. Conductor spawns `simctl ... log stream`
  // as a grandchild and SIGTERM on the parent alone leaves the grandchild
  // reparented to launchd.
  const proc = spawn(bin, finalArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const entry: DebugStream = {
    streamId,
    deviceKey,
    command: finalArgs.join(" "),
    proc,
  };
  streams.set(streamId, entry);

  // Note the launch in the per-device conductor log.
  conductorLogStore.push({
    ts: Date.now(),
    deviceKey,
    kind: "cli",
    command: finalArgs[0] ?? "conductor",
    args: finalArgs.join(" "),
    durationMs: 0,
    ok: true,
    output: "(debug stream started)",
  });

  const onLine = (chunk: Buffer, source: "stderr" | "stdout") => {
    const text = chunk.toString("utf8");
    send(`debug:data:${streamId}`, { text, source });
  };
  proc.stdout?.on("data", (c: Buffer) => onLine(c, "stdout"));
  proc.stderr?.on("data", (c: Buffer) => onLine(c, "stderr"));

  let exited = false;
  const emitExit = (payload: {
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: string;
  }) => {
    if (exited) {
      return;
    }
    exited = true;
    streams.delete(streamId);
    send(`debug:exit:${streamId}`, payload);
  };

  proc.once("exit", (code, signal) => {
    log.info(`debug stream ${streamId} exited code=${code} signal=${signal}`);
    emitExit({ code, signal });
  });
  // Spawn failures (e.g. ENOENT when the conductor binary is missing) surface
  // here. Forward them as an exit event so the renderer can reset its
  // running state — otherwise the Start button stays stuck on "Stop".
  proc.once("error", (err) => {
    log.error(`debug stream ${streamId} error:`, err);
    send(`debug:data:${streamId}`, {
      text: `\n[conductor failed to start: ${err.message}]\n`,
      source: "stderr",
    });
    emitExit({ code: null, signal: null, error: err.message });
  });
}

export function stopDebugStream(streamId: string): void {
  const entry = streams.get(streamId);
  if (!entry) {
    return;
  }
  log.info(`stopping debug stream ${streamId}`);
  killProcessGroup(entry.proc, "SIGTERM");
  // Escalate to SIGKILL if the tree is still alive after 1 s — conductor
  // doesn't always propagate SIGTERM to its `simctl log stream` grandchild.
  setTimeout(() => {
    if (streams.has(streamId)) {
      log.info(`debug stream ${streamId} still alive after SIGTERM, SIGKILL`);
      killProcessGroup(entry.proc, "SIGKILL");
    }
  }, 1000).unref();
  // `exit` handler clears the map.
}

function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  const pid = proc.pid;
  if (pid === undefined) {
    return;
  }
  try {
    // Negative pid signals the whole process group — kills conductor and
    // any `simctl` grandchildren it spawned.
    process.kill(-pid, signal);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return;
    }
    try {
      proc.kill(signal);
    } catch (err) {
      log.error(`failed to kill stream ${pid}:`, err);
    }
  }
}

export function listDebugStreams(): {
  streamId: string;
  deviceKey: string;
  command: string;
}[] {
  return Array.from(streams.values()).map((s) => ({
    streamId: s.streamId,
    deviceKey: s.deviceKey,
    command: s.command,
  }));
}

export interface DebugCommandResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  error?: string;
  durationMs: number;
}

/**
 * Run a one-shot conductor command (e.g. `memory`) and return its stdout.
 * Failures are reported via the result struct so the UI can render an
 * error instead of blowing up the IPC channel.
 */
export async function runDebugCommand(
  deviceKey: string,
  args: string[],
): Promise<DebugCommandResult> {
  const t0 = Date.now();
  const finalArgs = ensureDeviceFlag(deviceKey, args);
  try {
    const result = await execConductor(deviceKey, finalArgs);

    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    const err = e as { message?: string; stderr?: string; stdout?: string };

    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr,
      error: err.message ?? String(e),
      durationMs: Date.now() - t0,
    };
  }
}

/** Stop every running debug stream. Called on app quit. */
export function stopAllDebugStreams(): void {
  for (const id of Array.from(streams.keys())) {
    stopDebugStream(id);
  }
}
