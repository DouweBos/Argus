/**
 * Injection lifecycle for the inspector: probe whether the running app has the
 * in-process control library, list installed apps, and (re)launch an app with
 * `--inject` so `native-inspect` works.
 *
 * The UX this backs: a user either has an app running they want to inspect (we
 * offer "restart with inspection") or nothing running (we offer a picker of
 * installed apps) — either way one action gets them to an injected, inspectable
 * app.
 */

import { execFile } from "node:child_process";
import { createLogger } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { runConductor } from "./capture";
import {
  friendlyInjectError,
  inprocUnavailableReason,
  simulatorPlatform,
} from "./inprocSupport";

const log = createLogger("inspection:launcher");

const SPRINGBOARD = "com.apple.springboard";

export interface InjectionProbe {
  /** The in-process server answered `native-ping` — ready to inspect. */
  injected: boolean;
  /** Foreground app bundle id, or null when on the home screen / unknown. */
  foregroundApp: string | null;
  /** True when nothing inspectable is foregrounded (SpringBoard / home screen). */
  isSpringboard: boolean;
  /** Why the app can't be relaunched with inspection here, or null. */
  injectUnavailableReason: string | null;
}

export interface InstalledApp {
  bundleId: string;
  name: string;
}

/** Parse `conductor`'s `{status,message}` JSON, tolerating extra log noise. */
function parseJsonLine(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!line) {
    return null;
  }
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Is the injected in-process server reachable, and what's foregrounded? Both
 * checks are best-effort — a failure reads as "not injected / unknown" so the
 * UI falls back to the launch affordances rather than erroring.
 */
export async function probeInjection(
  deviceKey: string,
): Promise<InjectionProbe> {
  if (!deviceKey) {
    throw "No active device — boot an iOS/tvOS simulator before inspecting.";
  }

  const ping = await runConductor([
    "native-ping",
    "--device",
    deviceKey,
    "--json",
  ]).catch(() => null);
  const injected =
    !!ping && ping.code === 0 && parseJsonLine(ping.stdout)?.status === "ok";

  const fg = await runConductor([
    "foreground-app",
    "--device",
    deviceKey,
    "--json",
  ]).catch(() => null);
  let foregroundApp: string | null = null;
  if (fg && fg.code === 0) {
    const msg = parseJsonLine(fg.stdout)?.message;
    if (typeof msg === "string" && msg.length > 0) {
      foregroundApp = msg;
    }
  }

  const isSpringboard = !foregroundApp || foregroundApp === SPRINGBOARD;
  const injectUnavailableReason = injected
    ? null
    : inprocUnavailableReason(await simulatorPlatform(deviceKey));

  return {
    injected,
    foregroundApp: isSpringboard ? null : foregroundApp,
    isSpringboard,
    injectUnavailableReason,
  };
}

/** Validate a simulator UDID before interpolating it into a shell command. */
function isPlausibleUdid(id: string): boolean {
  return /^[A-Za-z0-9-]{6,}$/.test(id);
}

/**
 * User-installed apps on the simulator, with display names — the picker shown
 * when nothing is foregrounded. System apps (`com.apple.*`) are excluded via
 * `ApplicationType == "User"`.
 */
export async function listInstalledApps(
  deviceKey: string,
): Promise<InstalledApp[]> {
  if (!isPlausibleUdid(deviceKey)) {
    throw "Installed-app listing is only available for iOS/tvOS simulators.";
  }

  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      "bash",
      [
        "-c",
        `xcrun simctl listapps ${deviceKey} | plutil -convert json - -o -`,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  }).catch((err: Error) => {
    log.error("simctl listapps failed", err);
    throw "Could not list installed apps — is the simulator booted?";
  });

  let parsed: Record<string, Record<string, unknown>>;
  try {
    parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  } catch {
    throw "Could not parse the installed-app list from simctl.";
  }

  const apps: InstalledApp[] = [];
  for (const [bundleId, meta] of Object.entries(parsed)) {
    if (meta?.ApplicationType !== "User") {
      continue;
    }
    const name =
      (typeof meta.CFBundleDisplayName === "string" &&
        meta.CFBundleDisplayName) ||
      (typeof meta.CFBundleName === "string" && meta.CFBundleName) ||
      bundleId;
    apps.push({ bundleId, name });
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));

  return apps;
}

/**
 * Launch (or relaunch) an app with the in-process library injected. `launch-app`
 * itself waits for the in-process server to answer, so on success `native-inspect`
 * is immediately usable.
 */
export async function launchInjected(
  deviceKey: string,
  bundleId: string,
): Promise<{ ok: boolean }> {
  if (!deviceKey || !bundleId) {
    throw "Missing device or app id.";
  }
  const platform = await simulatorPlatform(deviceKey);
  const unavailable = inprocUnavailableReason(platform);
  if (unavailable) {
    capture("simulator_inspection_launched", {
      platform,
      outcome: "unavailable",
    });
    throw unavailable;
  }
  const res = await runConductor([
    "launch-app",
    bundleId,
    "--device",
    deviceKey,
    "--inject",
    "--json",
  ]);
  if (res.code !== 0) {
    const msg = parseJsonLine(res.stdout)?.message;
    const raw =
      typeof msg === "string" && msg
        ? msg
        : res.stderr.trim() || `launch-app ${bundleId} --inject failed`;
    capture("simulator_inspection_launched", { platform, outcome: "failed" });
    throw friendlyInjectError(raw, platform);
  }
  capture("simulator_inspection_launched", { platform, outcome: "ok" });

  return { ok: true };
}
