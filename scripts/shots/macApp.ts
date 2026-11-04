/**
 * The Mac app under capture: a Debug build, re-bundled under its own bundle id
 * so its `UserDefaults` never touch a developer's "Argus Dev", launched by path
 * as a window attached to the fixture host. Only ever signals its own pid.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DevDriver, sleep } from "./devDriver";

const run = promisify(execFile);

export const BUNDLE_ID = "dev.houwert.argus.mac.shots";

/** Points: the old web captures' viewport, so crops and the site's layout carry over. */
export const WINDOW = { width: 1600, height: 1000 };

export async function buildApp(root: string): Promise<string> {
  const derived = path.join(root, ".build/mac-shots-dd");
  await run(
    "xcodebuild",
    [
      "-project",
      "clients/apple/ArgusRemote.xcodeproj",
      "-scheme",
      "ArgusDesktop",
      "-destination",
      "platform=macOS,arch=arm64",
      "-derivedDataPath",
      derived,
      "build",
      "-quiet",
    ],
    { cwd: root, maxBuffer: 1024 * 1024 * 64 },
  );

  return path.join(derived, "Build/Products/Debug/Argus.app");
}

/**
 * A copy with its own bundle id, ad-hoc signed without entitlements (Sign in
 * with Apple is tied to the real id), and without the bundled Node host: an
 * attach-only window never starts one.
 */
export async function bundleForShots(
  built: string,
  root: string,
): Promise<string> {
  const dir = path.join(root, ".build/shots");
  const app = path.join(dir, "Argus.app");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await run("ditto", [built, app]);
  fs.rmSync(path.join(app, "Contents/Resources/host"), {
    recursive: true,
    force: true,
  });
  const plist = path.join(app, "Contents/Info.plist");
  await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleIdentifier ${BUNDLE_ID}`,
    "-c",
    "Set :CFBundleDisplayName Argus",
    plist,
  ]);
  await run("codesign", ["--force", "--deep", "--sign", "-", app]);

  return app;
}

export interface RunningApp {
  driver: DevDriver;
  quit: () => Promise<void>;
  windowNumber: () => Promise<number>;
}

/** `-key value` launch arguments: read-only, they never reach the defaults file. */
const SEEDED_DEFAULTS: Record<string, string> = {
  // An ad-hoc build has no notification grant; the card would nag in every shot.
  "home.notificationsCardDismissed": "YES",
  "argus:menuBar.show": "NO",
};

export async function launchApp(
  app: string,
  home: string,
  work: string,
): Promise<RunningApp> {
  // Window frames, split widths and picks from an earlier run would leak in.
  await run("defaults", ["delete", BUNDLE_ID]).catch(() => undefined);
  const driver = new DevDriver(path.join(work, "driver"));
  const log = fs.openSync(path.join(work, "app.log"), "w");
  const args = Object.entries(SEEDED_DEFAULTS).flatMap(([key, value]) => [
    `-${key}`,
    value,
  ]);
  const child: ChildProcess = spawn(
    path.join(app, "Contents/MacOS/Argus"),
    args,
    {
      env: {
        ...process.env,
        ARGUS_HOME: home,
        ARGUS_ATTACH_HOME: home,
        ARGUS_DEV_DRIVER: driver.dir,
        ARGUS_SPINNER_VERB: "Simmering",
      },
      stdio: ["ignore", log, log],
    },
  );

  const windowNumber = async () => {
    const out = await driver.run({ op: "windows" });
    const line = (out.windows as string[]).find(
      (w) => w.includes("id=main") && w.includes("visible=true"),
    );
    if (!line) {
      throw new Error("no main window");
    }

    return Number.parseInt(line, 10);
  };

  // The first answer means the driver's timer runs, i.e. the app finished launching.
  await driver.run({ op: "windows" }, 60_000);

  return {
    driver,
    windowNumber,
    quit: async () => {
      if (child.exitCode !== null) {
        return;
      }
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await Promise.race([exited, sleep(5000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    },
  };
}

/**
 * The window as WindowServer composites it, glass included, without its
 * shadow. A view snapshot can't draw SwiftUI's layers, so this is the only
 * faithful picture; it needs Screen Recording for whoever runs the script.
 */
export async function captureWindow(
  windowNumber: number,
  out: string,
): Promise<void> {
  await run("screencapture", ["-x", "-o", `-l${windowNumber}`, out]);
}
