/**
 * `conductor capture-ui` wrapper.
 *
 * Uses `--output <path>` to write the bundle to a temp file rather than
 * streaming JSON through stdout. When conductor is spawned with a piped
 * (non-TTY) stdout, `process.stdout.write` is asynchronous — the child can
 * `process.exit(0)` before the kernel pipe buffer (8 KiB on macOS) drains,
 * truncating multi-MB captures. Writing to disk and reading it back sidesteps
 * the pipe entirely.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "../../../app/lib/logger";
import { getConductorBinPath } from "../cli/conductor";
import { conductorLogStore } from "../conductor/logger";

const log = createLogger("inspection:capture");

export interface CaptureRequest {
  deviceKey: string;
}

function runCaptureUi(
  deviceKey: string,
  outputPath: string,
): Promise<{ durationMs: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const args = [
      "capture-ui",
      "--device",
      deviceKey,
      "--output",
      outputPath,
      "--json",
    ];
    const child = spawn(getConductorBinPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const durationMs = Date.now() - t0;
      if (code === 0) {
        resolve({ stdout, durationMs });
      } else {
        reject(
          new Error(stderr.trim() || `conductor exited with code ${code}`),
        );
      }
    });
  });
}

function logLine(
  deviceKey: string,
  ts: number,
  durationMs: number,
  ok: boolean,
  outputOrError: string,
): void {
  conductorLogStore.push({
    ts,
    deviceKey,
    kind: "cli",
    command: "capture-ui",
    args: `capture-ui --device ${deviceKey} --output <tmp> --json`,
    durationMs,
    ok,
    ...(ok ? { output: outputOrError } : { error: outputOrError }),
  });
}

export async function captureUi(req: CaptureRequest): Promise<unknown> {
  const { deviceKey } = req;
  if (!deviceKey) {
    throw "No active device — select a simulator/emulator before inspecting.";
  }

  const t0 = Date.now();
  const outputPath = path.join(
    tmpdir(),
    `argus-capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );

  try {
    const { durationMs } = await runCaptureUi(deviceKey, outputPath);
    const bytes = await fs.readFile(outputPath, "utf8");
    logLine(
      deviceKey,
      t0,
      durationMs,
      true,
      `capture-ui ok — ${bytes.length} bytes`,
    );
    try {
      return JSON.parse(bytes);
    } catch (err) {
      log.error(
        `conductor capture-ui wrote non-JSON output (${bytes.length} bytes)`,
        err,
      );
      throw "conductor capture-ui produced invalid JSON. Is the CLI up to date?";
    }
  } catch (e) {
    const msg = typeof e === "string" ? e : ((e as Error).message ?? String(e));
    logLine(deviceKey, t0, Date.now() - t0, false, msg);
    if (typeof e === "string") {
      throw e;
    }
    throw `conductor capture-ui failed: ${msg}`;
  } finally {
    fs.unlink(outputPath).catch(() => {
      // Ignore — tmp cleanup is best-effort.
    });
  }
}
