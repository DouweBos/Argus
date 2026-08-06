/**
 * Native inspection: reads the running iOS/tvOS app *in-process* via the
 * injected control library (`launch-app --inject`) — real classes, colors,
 * fonts, and the full UIView/CALayer tree, far richer than XCUITest `capture-ui`.
 *
 * The tree is fetched **directly over HTTP** from the in-process server rather
 * than through `native-inspect`'s stdout: large trees truncate when the CLI
 * `process.exit(0)`s before its `console.log` drains the pipe ("Unexpected end
 * of JSON input"). HTTP has a proper end-of-body, so the whole tree arrives. The
 * CLI is kept as a fallback when the port isn't discoverable. The screenshot
 * still goes through `native-screenshot --output <file>` (file, not stdout).
 *
 * Requires the app to have been launched with `launch-app <appId> --inject`.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "../../../app/lib/logger";
import { getConductorBinPath } from "../cli/conductor";
import { conductorLogStore } from "../conductor/logger";
import { inprocGetJson, readInprocPort } from "./inproc";

const log = createLogger("inspection:capture");

export interface CaptureRequest {
  deviceKey: string;
  /** iOS covers iPhone/iPad; tvOS is a separate Apple platform. Defaults to ios. */
  platform?: "ios" | "tvos";
}

export interface RunResult {
  code: number | null;
  durationMs: number;
  stderr: string;
  stdout: string;
}

export function runConductor(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(getConductorBinPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        durationMs: Date.now() - t0,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function logLine(
  command: string,
  argsText: string,
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
    command,
    args: argsText,
    durationMs,
    ok,
    ...(ok ? { output: outputOrError } : { error: outputOrError }),
  });
}

interface RawInspect {
  nodeCount?: number;
  status?: string;
  windows?: { frame?: { h?: number; w?: number } }[];
}

/** Base64 PNG of the key window via `native-screenshot --output`. Best-effort. */
async function captureScreenshot(deviceKey: string): Promise<string | null> {
  const outputPath = path.join(
    tmpdir(),
    `argus-native-shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );
  try {
    const res = await runConductor([
      "native-screenshot",
      "--device",
      deviceKey,
      "--output",
      outputPath,
      "--json",
    ]);
    if (res.code !== 0) {
      return null;
    }
    const png = await fs.readFile(outputPath);

    return png.toString("base64");
  } catch (err) {
    log.warn("native-screenshot failed; rendering bare boxes", err);

    return null;
  } finally {
    fs.unlink(outputPath).catch(() => {
      // best-effort tmp cleanup
    });
  }
}

/** native-inspect via the CLI — used only as a fallback (can truncate large trees). */
async function inspectViaCli(deviceKey: string): Promise<RawInspect> {
  const res = await runConductor([
    "native-inspect",
    "--device",
    deviceKey,
    "--json",
  ]);
  if (res.code !== 0) {
    throw (
      res.stderr.trim() ||
      "native-inspect failed. Launch the app with: launch-app <appId> --inject"
    );
  }
  try {
    return JSON.parse(res.stdout) as RawInspect;
  } catch {
    throw `native-inspect stdout was truncated (${res.stdout.length} bytes) — the tree is too large for the CLI pipe. Relaunch the app with --inject so the direct in-process port is available.`;
  }
}

/**
 * Fetch the view tree, preferring the direct in-process HTTP endpoint (no
 * truncation) and falling back to the CLI when the port isn't discoverable.
 */
async function loadInspect(
  deviceKey: string,
): Promise<{ inspect: RawInspect; via: string }> {
  const port = readInprocPort(deviceKey);
  if (port !== null) {
    try {
      const inspect = await inprocGetJson<RawInspect>(port, "/inspect");

      return { inspect, via: `http:${port}` };
    } catch (err) {
      log.warn(
        `direct in-process /inspect on :${port} failed; falling back to CLI`,
        err,
      );
    }
  } else {
    log.warn(
      `no in-process port for ${deviceKey} in ~/.conductor/inproc-ports.json; using CLI`,
    );
  }

  return { inspect: await inspectViaCli(deviceKey), via: "cli" };
}

export async function captureUi(req: CaptureRequest): Promise<unknown> {
  const { deviceKey, platform = "ios" } = req;
  if (!deviceKey) {
    throw "No active device — boot an iOS/tvOS simulator before inspecting.";
  }

  const t0 = Date.now();
  const argsText = `native-inspect --device ${deviceKey} --json`;

  let inspect: RawInspect;
  let via: string;
  try {
    ({ inspect, via } = await loadInspect(deviceKey));
  } catch (e) {
    const msg = typeof e === "string" ? e : ((e as Error).message ?? String(e));
    log.error(`native-inspect failed for ${deviceKey}`, msg);
    logLine(
      "native-inspect",
      argsText,
      deviceKey,
      t0,
      Date.now() - t0,
      false,
      msg,
    );
    throw msg;
  }

  if (inspect.status && inspect.status !== "ok") {
    const msg = `native-inspect status: ${inspect.status}`;
    logLine(
      "native-inspect",
      argsText,
      deviceKey,
      t0,
      Date.now() - t0,
      false,
      msg,
    );
    throw msg;
  }

  const screenshot = await captureScreenshot(deviceKey);

  const rootFrame = inspect.windows?.[0]?.frame ?? {};
  log.info(
    `native-inspect ok via ${via} — ${inspect.nodeCount ?? 0} nodes, ${inspect.windows?.length ?? 0} windows`,
  );
  logLine(
    "native-inspect",
    argsText,
    deviceKey,
    t0,
    Date.now() - t0,
    true,
    `native-inspect ok (${via}) — ${inspect.nodeCount ?? 0} nodes`,
  );

  return {
    capturedAt: new Date(t0).toISOString(),
    device: {
      platform,
      deviceId: deviceKey,
      width: rootFrame.w ?? 0,
      height: rootFrame.h ?? 0,
    },
    inspect,
    screenshot: screenshot
      ? { kind: "composite", encoding: "png", data: screenshot }
      : undefined,
  };
}
