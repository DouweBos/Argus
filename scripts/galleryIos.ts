/**
 * The iOS half of `pnpm gallery --ios`: builds the Debug iOS app for the
 * simulator, boots a throwaway simulator of its own through conductor (never
 * one of the user's, deleted when the run ends), launches the app in gallery
 * mode and waits for `index.json`. Stories live in
 * `clients/apple/ArgusRemote/Gallery/`, with the same ids as the Mac's.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const BUNDLE_ID = "dev.houwert.argus.remote";

export interface IosOptions {
  root: string;
  filter: string;
  themes: string;
  out: string;
  build: boolean;
  /** A simulator device type, e.g. "iPhone 17" or "iPad Pro 13-inch (M5)". */
  device: string;
}

async function conductor(args: string[]): Promise<string> {
  const { stdout } = await run("conductor", args, {
    maxBuffer: 1024 * 1024 * 16,
  });

  return stdout;
}

async function buildApp(root: string): Promise<string> {
  const derived = path.join(root, ".build/ios-gallery-dd");
  try {
    await run(
      "xcodebuild",
      [
        "-project",
        "clients/apple/ArgusRemote.xcodeproj",
        "-scheme",
        "ArgusRemote",
        "-configuration",
        "Debug",
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        derived,
        "build",
        "-quiet",
      ],
      { cwd: root, maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (error) {
    const out = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
    const errors = out.split("\n").filter((line) => line.includes("error:"));
    throw new Error(
      `xcodebuild failed:\n${(errors.length ? errors : out.split("\n").slice(-30)).join("\n")}`,
    );
  }

  return path.join(
    derived,
    "Build/Products/Debug-iphonesimulator/ArgusRemote.app",
  );
}

/** Short and stable per checkout: worktrees rendering at once each get their own output. */
export function checkoutTag(root: string): string {
  return crypto
    .createHash("sha1")
    .update(path.resolve(root))
    .digest("hex")
    .slice(0, 6);
}

const PREFIX = "argus-gallery-";

interface SimDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
}

async function listDevices(): Promise<SimDevice[]> {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "-j"]);

  return Object.values(
    (JSON.parse(stdout) as { devices: Record<string, SimDevice[]> }).devices,
  ).flat();
}

async function deleteDevice(udid: string): Promise<void> {
  await conductor(["delete-device", udid, "--platform", "ios"]);
}

/** Created minutes ago: another run may not have booted it yet. */
function isFresh(udid: string): boolean {
  const dir = path.join(
    os.homedir(),
    "Library/Developer/CoreSimulator/Devices",
    udid,
  );
  try {
    return Date.now() - fs.statSync(dir).birthtimeMs < 10 * 60_000;
  } catch {
    return false;
  }
}

/** Leftovers from older runs; Booted ones may belong to a run in progress, so they stay. */
async function sweepLeftovers(): Promise<void> {
  const stale = (await listDevices()).filter(
    (d) =>
      d.name.startsWith(PREFIX) && d.state === "Shutdown" && !isFresh(d.udid),
  );
  let removed = 0;
  for (const device of stale) {
    removed += await deleteDevice(device.udid).then(
      () => 1,
      () => 0,
    );
  }
  if (removed > 0) {
    process.stderr.write(
      `removed ${removed} leftover gallery simulator${removed === 1 ? "" : "s"}\n`,
    );
  }
}

/** A throwaway simulator for this run, deleted when it ends. */
async function createSimulator(
  deviceType: string,
  root: string,
): Promise<{ id: string; name: string }> {
  const type = deviceType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-$/, "");
  const random = crypto.randomBytes(3).toString("hex");
  const name = `${PREFIX}${type}-${checkoutTag(root)}-${random}`;
  const created = await run("xcrun", ["simctl", "create", name, deviceType]);

  return { id: created.stdout.trim(), name };
}

export async function renderIos(options: IosOptions): Promise<void> {
  const app = options.build
    ? await buildApp(options.root)
    : path.join(
        options.root,
        ".build/ios-gallery-dd/Build/Products/Debug-iphonesimulator/ArgusRemote.app",
      );
  if (!fs.existsSync(app)) {
    throw new Error("no iOS gallery build yet — drop --no-build");
  }
  await sweepLeftovers();
  const sim = await createSimulator(options.device, options.root);
  let cleanup: Promise<void> | undefined;
  const cleanUp = (): Promise<void> =>
    (cleanup ??= conductor(["stop-device", sim.id])
      .catch(() => undefined)
      .then(() => deleteDevice(sim.id))
      .catch(() => undefined));
  const onSignal = async (signal: NodeJS.Signals): Promise<void> => {
    await cleanUp();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await conductor([
      "start-device",
      "--platform",
      "ios",
      "--device-name",
      sim.name,
    ]);
    await conductor(["install-app", app, "--device", sim.id]);
    fs.rmSync(options.out, { recursive: true, force: true });
    fs.mkdirSync(options.out, { recursive: true });
    const index = path.join(options.out, "index.json");
    await conductor([
      "launch-app",
      BUNDLE_ID,
      "--device",
      sim.id,
      "--argument",
      "ARGUS_GALLERY=render",
      "--argument",
      `ARGUS_GALLERY_OUT=${options.out}`,
      "--argument",
      `ARGUS_GALLERY_FILTER=${options.filter}`,
      "--argument",
      `ARGUS_GALLERY_THEMES=${options.themes}`,
    ]);
    const deadline = Date.now() + 300_000;
    while (!fs.existsSync(index)) {
      if (Date.now() > deadline) {
        throw new Error("the iOS gallery never wrote index.json");
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const entries = JSON.parse(fs.readFileSync(index, "utf8")) as {
      path: string;
      unanswered: string[];
    }[];
    if (entries.length === 0) {
      throw new Error(`no iOS story matches "${options.filter}"`);
    }
    for (const entry of entries) {
      const missing = entry.unanswered.length
        ? `  (no fixture: ${entry.unanswered.join(", ")})`
        : "";
      process.stdout.write(`${entry.path}${missing}\n`);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await cleanUp();
  }
}
