/**
 * SimBridge — JSON-over-stdio client for the stagehand-sim-bridge binary.
 *
 * The bridge binary wraps StagehandBridge.swift + StagehandHID.m and exposes
 * all simulator capabilities (framebuffer capture, touch, keyboard) as a
 * newline-delimited JSON protocol over stdin/stdout.
 *
 * Protocol (request → response, one JSON object per line):
 *
 *   {"cmd":"start_capture","udid":"..."}  → {"ok":true,"port":12345}
 *   {"cmd":"stop_capture"}                → {"ok":true}
 *   {"cmd":"touch","udid":"...","x":0.5,"y":0.5,"type":0}  → {"ok":true}
 *   {"cmd":"button","udid":"...","button":"home"}           → {"ok":true}
 *   {"cmd":"keyboard","udid":"...","keyCode":36,
 *           "modifierFlags":0,"isDown":true}                → {"ok":true}
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";
import path from "node:path";
import { app } from "electron";

// ---------------------------------------------------------------------------
// Binary path resolution
// ---------------------------------------------------------------------------

const BINARY_NAME = "stagehand-sim-bridge";

/**
 * Resolve the path to the bridge binary.
 *
 * - Packaged app: `<app>/Contents/Resources/stagehand-sim-bridge`
 *   (process.resourcesPath is set by Electron for packaged builds)
 * - Development: relative to this compiled file inside the electron output
 *   directory — `electron/native/stagehand-sim-bridge/stagehand-sim-bridge`
 */
function bridgeBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, BINARY_NAME);
  }

  // In dev, resolve from the project root (cwd).
  return path.join(
    process.cwd(),
    "native",
    "stagehand-sim-bridge",
    BINARY_NAME,
  );
}

// ---------------------------------------------------------------------------
// Pending request tracking
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
}

// ---------------------------------------------------------------------------
// SimBridge class
// ---------------------------------------------------------------------------

/**
 * JSON-over-stdio client for the stagehand-sim-bridge native binary.
 *
 * The protocol is strictly sequential: one command is in flight at a time.
 * Responses are matched to requests by FIFO order — the bridge guarantees
 * one response per command before accepting the next.
 */
export class SimBridge {
  /** Singleton instance, managed by ios.ts. */
  static instance: SimBridge | null = null;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;

  /** FIFO queue of pending requests waiting for a response line. */
  private pending: PendingRequest[] = [];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Spawn the bridge binary process.
   *
   * Idempotent — if the process is already running this is a no-op.
   */
  spawn(): void {
    if (this.proc) {
      return;
    }

    const binaryPath = bridgeBinaryPath();

    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stderr.on("data", (chunk: Buffer) => {
      // Forward bridge stderr to the main process stderr for diagnostics
      process.stderr.write(`[stagehand-sim-bridge] ${chunk.toString()}`);
    });

    child.on("error", (err) => {
      console.error("[SimBridge] process error:", err);
      this.rejectAllPending(err);
      this.cleanup();
    });

    child.on("close", (code) => {
      console.error(`[SimBridge] process exited with code ${String(code)}`);
      this.rejectAllPending(
        new Error(`Bridge process exited (code ${String(code)})`),
      );
      this.cleanup();
    });

    // Set up line-delimited JSON reader on stdout
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      this.handleLine(line);
    });

    this.proc = child;
    this.rl = rl;
  }

  /**
   * Send a command to the bridge and wait for its JSON response.
   *
   * @throws if the bridge process is not running, the stdin write fails, or
   *   the response is not valid JSON.
   */
  sendCommand(
    cmd: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) {
        reject(new Error("Bridge process is not running"));
        return;
      }

      this.pending.push({ resolve, reject });

      const line = JSON.stringify(cmd) + "\n";
      this.proc.stdin.write(line, (err) => {
        if (err) {
          // Remove the pending entry we just pushed and reject
          const idx = this.pending.findIndex((p) => p.reject === reject);
          if (idx !== -1) {
            this.pending.splice(idx, 1);
          }
          reject(err);
        }
      });
    });
  }

  /**
   * Kill the bridge process and clean up.
   *
   * Any in-flight commands are rejected.
   */
  kill(): void {
    if (this.proc) {
      this.proc.kill();
    }
    this.cleanup();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const waiter = this.pending.shift();
    if (!waiter) {
      // Unsolicited output — log and discard
      console.warn("[SimBridge] unexpected output:", trimmed);
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (e) {
      waiter.reject(
        new Error(`Bridge returned invalid JSON: ${trimmed}`),
      );
      return;
    }

    waiter.resolve(parsed);
  }

  private rejectAllPending(reason: unknown): void {
    const drained = this.pending.splice(0);
    for (const waiter of drained) {
      waiter.reject(reason);
    }
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.proc = null;

    if (SimBridge.instance === this) {
      SimBridge.instance = null;
    }
  }
}
