/**
 * One PNG of what a local simulator or emulator shows right now. Best-effort:
 * null when the device is gone, remote, or the tooling isn't installed.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { findAdb } from "./android";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;

export async function iosScreenshot(udid: string): Promise<Buffer | null> {
  const file = path.join(
    tmpdir(),
    `argus-shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );
  try {
    await execFileAsync("xcrun", ["simctl", "io", udid, "screenshot", file], {
      timeout: TIMEOUT_MS,
    });

    return await fs.readFile(file);
  } catch {
    return null;
  } finally {
    fs.unlink(file).catch(() => {});
  }
}

async function androidScreenshot(serial: string): Promise<Buffer | null> {
  try {
    const adb = await findAdb();
    const { stdout } = await execFileAsync(
      adb,
      ["-s", serial, "exec-out", "screencap", "-p"],
      { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: TIMEOUT_MS },
    );

    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

export function devicePng(
  platform: "android" | "ios",
  deviceKey: string,
): Promise<Buffer | null> {
  return platform === "ios"
    ? iosScreenshot(deviceKey)
    : androidScreenshot(deviceKey);
}

export async function deviceScreenshot(
  platform: "android" | "ios",
  deviceKey: string,
): Promise<string | null> {
  const png = await devicePng(platform, deviceKey);

  return png ? png.toString("base64") : null;
}
