/**
 * The Electron server's way out: it updates by handing the machine over to the
 * native `Argus Server.app`.
 *
 * The desktop feed can't update a server — Squirrel.Mac only installs a bundle
 * that satisfies the running app's designated requirement, and that feed ships
 * `dev.houwert.argus`. So the tray checks the native app's Sparkle appcast
 * instead, and installing downloads it, proves it is our signed native build,
 * and swaps the bundle in place from a detached script once this process quits.
 * Anything that fails before the quit leaves the old app exactly as it was.
 */

import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { argusHomeDir } from "@argus/host/lib/argusHome";
import { isServerMode } from "@argus/host/serverMode";
import {
  loadAppSettings,
  saveAppSettings,
} from "@argus/host/services/appSettings/store";
import { capture } from "@argus/host/services/telemetry/telemetry";
import { createLogger } from "../app/lib/logger";
import {
  HANDOFF_SCRIPT,
  appBundleFromExecPath,
  designatedRequirementMatches,
  nativeAppcastUrl,
  nativeBundleProblem,
  parseNewestAppcastItem,
  shouldOfferNative,
  type AppcastItem,
} from "./serverHandoffModel";
import { countActiveAgents } from "./services/agentActivity";

const execFileAsync = promisify(execFile);
const logger = createLogger("server-handoff");

export type HandoffState =
  | { kind: "available"; version: string }
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "installing"; version: string }
  | { kind: "up_to_date" };

export type HandoffVerdict =
  | { ok: false; reason: "agents_running"; activeAgents: number }
  | { ok: false; reason: "not_available" }
  | { ok: true };

let state: HandoffState = { kind: "idle" };
let offer: AppcastItem | null = null;
let onChange: (() => void) | null = null;
let checkTimer: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;
/** One `offered` / `blocked_by_agents` per version, not one per check or idle sweep. */
const reported = new Set<string>();

function setState(next: HandoffState): void {
  state = next;
  onChange?.();
}

function reportOnce(stage: "blocked_by_agents" | "offered", key: string): void {
  if (!reported.has(`${stage}:${key}`)) {
    reported.add(`${stage}:${key}`);
    capture("electron_server_handoff", { stage });
  }
}

export function setHandoffListener(listener: (() => void) | null): void {
  onChange = listener;
}

export function getHandoffState(): HandoffState {
  return state;
}

/** `silent` is the background poll: no "checking" flicker, no feed errors in the menu. */
export async function checkForNativeServer(silent = false): Promise<void> {
  if (state.kind === "installing") {
    return;
  }
  if (!silent) {
    setState({ kind: "checking" });
  }
  try {
    const channel = loadAppSettings().updater_channel ?? "latest";
    const res = await fetch(nativeAppcastUrl(channel));
    // No appcast yet means no native release on this channel yet.
    if (!res.ok && res.status !== 404) {
      throw new Error(`the update feed answered ${res.status}`);
    }
    const item = res.ok ? parseNewestAppcastItem(await res.text()) : null;
    offer =
      item &&
      shouldOfferNative(item, app.getVersion(), process.getSystemVersion())
        ? item
        : null;
    if (offer) {
      reportOnce("offered", offer.version);
      setState({ kind: "available", version: offer.shortVersion });
      maybeAutoInstall();
    } else {
      setState({ kind: "up_to_date" });
    }
  } catch (err) {
    logger.warn("native server check failed:", String(err));
    if (!silent) {
      setState({ kind: "error", message: shortError(err) });
    }
  }
}

function shortError(err: unknown): string {
  const line = (err instanceof Error ? err.message : String(err)).split(
    "\n",
  )[0];

  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

/** Same guard as an update restart: agents die with the process. */
export function canHandOff(): HandoffVerdict {
  if (!offer || state.kind === "installing") {
    return { ok: false, reason: "not_available" };
  }
  const activeAgents = countActiveAgents();
  if (activeAgents > 0) {
    return { ok: false, reason: "agents_running", activeAgents };
  }

  return { ok: true };
}

/** Download, verify and hand off. Resolves once the quit is underway or it failed. */
export async function installNativeServer(): Promise<HandoffVerdict> {
  const verdict = canHandOff();
  if (!verdict.ok) {
    if (verdict.reason === "agents_running" && offer) {
      reportOnce("blocked_by_agents", offer.version);
    }

    return verdict;
  }
  const item = offer as AppcastItem;
  setState({ kind: "installing", version: item.shortVersion });
  capture("electron_server_handoff", { stage: "installing" });

  let tmp: string | null = null;
  try {
    const installed = appBundleFromExecPath(process.execPath);
    if (!app.isPackaged || !installed) {
      throw new Error("only a packaged Argus Server can hand off");
    }
    fs.accessSync(path.dirname(installed), fs.constants.W_OK);
    const migrated = path.join(argusHomeDir(), "migrated");
    fs.mkdirSync(migrated, { recursive: true });
    tmp = fs.mkdtempSync(path.join(migrated, "native-"));
    const fresh = await downloadAndVerify(item, tmp);
    // Re-check: an agent may have started during the download.
    if (countActiveAgents() > 0) {
      throw new Error("an agent started while downloading — try again");
    }
    spawnHandoff(
      installed,
      fresh,
      path.join(migrated, "Argus Server (Electron).app"),
      tmp,
    );
    logger.info("handing off to the native Argus Server, quitting");
    app.quit();

    return { ok: true };
  } catch (err) {
    logger.error("hand-off failed:", String(err));
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    capture("electron_server_handoff", { stage: "failed" });
    setState({ kind: "error", message: shortError(err) });

    return { ok: false, reason: "not_available" };
  }
}

async function downloadAndVerify(
  item: AppcastItem,
  tmp: string,
): Promise<string> {
  const zip = path.join(tmp, "Argus Server.zip");
  const res = await fetch(item.url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed (${res.status})`);
  }
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream),
    fs.createWriteStream(zip),
  );
  if (item.length !== null && fs.statSync(zip).size !== item.length) {
    throw new Error("the download is incomplete");
  }

  const extract = path.join(tmp, "extract");
  await execFileAsync("/usr/bin/ditto", ["-x", "-k", zip, extract]);
  const apps = fs.readdirSync(extract).filter((n) => n.endsWith(".app"));
  if (apps.length !== 1) {
    throw new Error("the download has no app in it");
  }
  const bundle = path.join(extract, apps[0]);

  await execFileAsync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    bundle,
  ]);
  // codesign prints the requirement on stdout or stderr depending on version.
  const dr = await execFileAsync("/usr/bin/codesign", ["-d", "-r-", bundle]);
  if (!designatedRequirementMatches(`${dr.stdout}\n${dr.stderr}`)) {
    throw new Error("the download is not signed by Argus");
  }
  const plist = await execFileAsync("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    path.join(bundle, "Contents", "Info.plist"),
  ]);
  const problem = nativeBundleProblem(
    JSON.parse(plist.stdout) as Record<string, unknown>,
    fs.existsSync(
      path.join(
        bundle,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
      ),
    ),
  );
  if (problem) {
    throw new Error(problem);
  }

  return bundle;
}

/** Detached and in its own session, so it outlives this app and launchd's job. */
function spawnHandoff(
  installed: string,
  fresh: string,
  backup: string,
  tmp: string,
): void {
  const log = fs.openSync(path.join(path.dirname(backup), "handoff.log"), "a");
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      HANDOFF_SCRIPT,
      "argus-handoff",
      String(process.pid),
      installed,
      fresh,
      backup,
      tmp,
    ],
    { cwd: os.homedir(), detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  fs.closeSync(log);
}

/** Off by default: a restart nobody asked for is a surprising thing for a mini. */
export function isServerAutoInstallEnabled(): boolean {
  return loadAppSettings().server_auto_install_updates === true;
}

export function setServerAutoInstallEnabled(enabled: boolean): void {
  saveAppSettings({
    ...loadAppSettings(),
    server_auto_install_updates: enabled,
  });
  onChange?.();
  maybeAutoInstall();
}

function maybeAutoInstall(): void {
  if (isServerAutoInstallEnabled() && state.kind === "available") {
    installNativeServer().catch(() => undefined);
  }
}

/** Server only: check shortly after launch and hourly; sweep for idleness every minute. */
export function initServerHandoff(): void {
  if (!isServerMode() || checkTimer) {
    return;
  }
  setTimeout(() => {
    checkForNativeServer(true).catch(() => undefined);
  }, 5_000);
  checkTimer = setInterval(
    () => {
      checkForNativeServer(true).catch(() => undefined);
    },
    60 * 60 * 1000,
  );
  idleTimer = setInterval(() => maybeAutoInstall(), 60_000);
}

export function stopServerHandoff(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  onChange = null;
}
