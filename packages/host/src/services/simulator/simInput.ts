/**
 * SimInput — JSON-over-stdio client for the argus-sim-input helper.
 *
 * Keyboard and hardware-button events cannot be injected from the host: the
 * legacy SimulatorKit Indigo path still carries digitizer events but drops
 * everything else, on every runtime from iOS 18.3 up. The guest's own HID event
 * system does accept them, so the helper is an iphonesimulator binary launched
 * inside the device with `simctl spawn` and fed newline-delimited JSON:
 *
 *   {"cmd":"key","page":7,"usage":4,"down":true}  -> {"ok":true}
 *   {"cmd":"button","page":12,"usage":64}         -> {"ok":true}  (down+up)
 *
 * One long-lived process per UDID — spawning per keystroke would add a few
 * hundred milliseconds to every key.
 */

import type { DeviceMachine } from "../deviceHosts/machine";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";
import { error, warn } from "@argus/host/logger";

/** The device a helper runs in, and the machine that reaches it. */
export interface SimInputTarget {
  deviceId: string;
  machine: DeviceMachine;
  /** The UDID as that machine knows it. */
  udid: string;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
}

/**
 * One spawned helper process. Requests are matched to responses by FIFO order —
 * the helper emits exactly one line per command.
 */
class SimInput {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending: PendingRequest[] = [];

  constructor(private readonly target: SimInputTarget) {}

  /** Launch the helper inside the simulator, on whichever Mac runs it. Idempotent. */
  async spawn(): Promise<void> {
    if (this.proc) {
      return;
    }

    const { machine, udid } = this.target;
    const helper = await machine.toolPath("argus-sim-input");
    if (this.proc) {
      return;
    }
    const child = machine.spawn("xcrun", ["simctl", "spawn", udid, helper]);

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[argus-sim-input] ${chunk.toString()}`);
    });

    child.on("error", (err) => {
      error("[SimInput] process error:", err);
      this.rejectAllPending(err);
      this.cleanup();
    });

    child.on("close", (code) => {
      if (this.pending.length > 0) {
        error(`[SimInput] process exited with code ${String(code)}`);
      }
      this.rejectAllPending(
        new Error(`Input helper exited (code ${String(code)})`),
      );
      this.cleanup();
    });

    readline
      .createInterface({ input: child.stdout, crlfDelay: Infinity })
      .on("line", (line) => this.handleLine(line));

    this.proc = child;
  }

  /** Send a command and wait for the helper's response line. */
  send(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin.writable) {
        reject(new Error("Input helper is not running"));

        return;
      }
      this.pending.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify(cmd) + "\n", (err) => {
        if (err) {
          const entry = this.pending.pop();
          entry?.reject(err);
        }
      });
    });
  }

  kill(): void {
    this.proc?.kill();
    this.cleanup();
  }

  private handleLine(line: string): void {
    const entry = this.pending.shift();
    if (!entry) {
      warn(`[SimInput] unexpected line: ${line}`);

      return;
    }
    try {
      entry.resolve(JSON.parse(line) as Record<string, unknown>);
    } catch (err) {
      entry.reject(err);
    }
  }

  private rejectAllPending(reason: unknown): void {
    const pending = this.pending;
    this.pending = [];
    for (const entry of pending) {
      entry.reject(reason);
    }
  }

  private cleanup(): void {
    this.proc = null;
  }
}

const inputsByUdid = new Map<string, SimInput>();

async function inputFor(target: SimInputTarget): Promise<SimInput> {
  let input = inputsByUdid.get(target.deviceId);
  if (!input) {
    input = new SimInput(target);
    inputsByUdid.set(target.deviceId, input);
  }
  await input.spawn();

  return input;
}

/** Stop the helper for a UDID, if one is running. */
export function stopSimInput(udid: string): void {
  inputsByUdid.get(udid)?.kill();
  inputsByUdid.delete(udid);
}

async function send(
  target: SimInputTarget,
  cmd: Record<string, unknown>,
  what: string,
): Promise<void> {
  // A helper that died with its simulator leaves a stale entry behind; drop it
  // and retry once so the caller doesn't have to know about respawns.
  let response: Record<string, unknown>;
  try {
    response = await (await inputFor(target)).send(cmd);
  } catch {
    stopSimInput(target.deviceId);
    response = await (await inputFor(target)).send(cmd);
  }
  if (!response.ok) {
    throw `${what} failed: ${String(response.error ?? "unknown error")}`;
  }
}

/** Send a key down or up for a HID usage on the keyboard page. */
export function sendKeyUsage(
  target: SimInputTarget,
  page: number,
  usage: number,
  down: boolean,
): Promise<void> {
  return send(target, { cmd: "key", page, usage, down }, "Key");
}

/** Send a hardware button as a down+up pair. */
export function sendButtonUsage(
  target: SimInputTarget,
  page: number,
  usage: number,
): Promise<void> {
  return send(target, { cmd: "button", page, usage }, "Button");
}
