/**
 * Auto-update orchestration. Wraps `electron-updater` with the small set of
 * states the renderer actually needs to drive the home banner, the menu bar
 * "Check for Updates…" item, and the "Update ready — restart now?" prompt.
 *
 * Update feed is configured in `electron-builder.release.cjs` (publish: generic
 * pointing at houwert.dev/argus/updates). Only runs in packaged builds.
 *
 * Once a native Argus for Mac release publishes `cutover-mac.yml`, a desktop
 * whose secrets are off `safeStorage` follows that feed instead: Squirrel.Mac
 * swaps the native app (same bundle id and team) in over this one.
 */

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { emitHostEvent } from "@argus/host/bus";
import { loadAppSettings } from "@argus/host/services/appSettings/store";
import { findLegacySecretStores } from "@argus/host/services/secrets/legacyStores";
import { capture } from "@argus/host/services/telemetry/telemetry";
import { createLogger } from "../../../app/lib/logger";

const logger = createLogger("updater");

export type UpdaterPhase =
  | "available"
  | "checking"
  | "downloaded"
  | "downloading"
  | "error"
  | "idle"
  | "not-available";

export interface UpdaterState {
  /** Current app version. */
  currentVersion: string;
  /** Latest error message from electron-updater, if any. */
  error: string | null;
  phase: UpdaterPhase;
  /** Download progress 0..100 while phase === "downloading". */
  progressPercent: number;
  /**
   * Release notes for the available/downloaded version. electron-updater
   * passes whatever the feed's YAML has — usually a string, sometimes an
   * array of `{version, note}` entries. We normalize to plain string at
   * the renderer boundary.
   */
  releaseNotes: string | null;
  /** ISO 8601 release date of the available/downloaded version. */
  releaseDate: string | null;
  /** The version available/downloaded (different from currentVersion). */
  updateVersion: string | null;
  /** When the renderer last successfully checked the feed. */
  lastCheckedAt: number | null;
}

let state: UpdaterState = {
  // `app` is undefined outside Electron (e.g. vitest importing this transitively).
  currentVersion: app?.getVersion() ?? "0.0.0",
  error: null,
  phase: "idle",
  progressPercent: 0,
  releaseNotes: null,
  releaseDate: null,
  updateVersion: null,
  lastCheckedAt: null,
};
let initialized = false;
let cutoverReported = false;
let onBeforeQuitAndInstall: (() => void) | null = null;

/**
 * Wire a callback that runs immediately before `autoUpdater.quitAndInstall`.
 * Used by main.ts to flip its `isQuitting` flag — without it the macOS
 * close handler hides the window instead of letting Squirrel.Mac terminate.
 */
export function setBeforeQuitAndInstallHook(hook: () => void): void {
  onBeforeQuitAndInstall = hook;
}

function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch };
  emitHostEvent("updater:state", state);
}

function normalizeReleaseNotes(
  notes: UpdateInfo["releaseNotes"],
): string | null {
  if (!notes) {
    return null;
  }
  if (typeof notes === "string") {
    return notes;
  }

  return notes
    .map((n) =>
      n.version ? `## ${n.version}\n\n${n.note ?? ""}` : (n.note ?? ""),
    )
    .filter(Boolean)
    .join("\n\n");
}

const FEED_URL = "https://houwert.dev/argus/updates";
const CUTOVER_CHANNEL = "cutover";

async function cutoverPublished(): Promise<boolean> {
  try {
    const res = await fetch(`${FEED_URL}/${CUTOVER_CHANNEL}-mac.yml`, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The native app reads paired devices and MCP sign-ins only once this app has
 * moved them off `safeStorage`, and after the swap nothing could, so a desktop
 * still holding one stays on its own feed and retries the move next launch.
 * Renderer prefs need no check: the renderer copies them on every load.
 */
async function feedChannel(): Promise<string> {
  const channel = loadAppSettings().updater_channel ?? "latest";
  if (!(await cutoverPublished())) {
    return channel;
  }
  const migrated = findLegacySecretStores().length === 0;
  if (!cutoverReported) {
    cutoverReported = true;
    capture("electron_desktop_cutover", {
      stage: migrated ? "offered" : "held_back",
    });
  }

  return migrated ? CUTOVER_CHANNEL : channel;
}

// Pinned to the houwert.dev reverse proxy regardless of what `publish:`
// resolves to in the packaged app-update.yml: the Argus repo on GitHub is
// private, so the github provider 404s on `releases.atom`. Beta builds publish
// under `beta-mac.yml`; alpha (`alpha-mac.yml`) isn't offered in the settings
// dialog, collaborators install it from the GitHub release page.
async function pointFeed(): Promise<void> {
  autoUpdater.setFeedURL({
    provider: "generic",
    url: FEED_URL,
    channel: await feedChannel(),
    useMultipleRangeRequest: true,
  });
}

/** Wire electron-updater event handlers. Idempotent. */
export function initUpdater(): void {
  if (initialized) {
    return;
  }
  if (!app.isPackaged) {
    logger.info("skipping updater init: not packaged");

    return;
  }
  initialized = true;

  // The user reads the changelog before deciding whether to update, so we
  // never start a download until they click "Download" in the dialog. And
  // we never auto-install on quit either — the restart prompt is explicit.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (...args: unknown[]) => logger.info(...args),
    warn: (...args: unknown[]) => logger.warn(...args),
    error: (...args: unknown[]) => logger.error(...args),
    debug: (...args: unknown[]) => logger.debug(...args),
  } as typeof autoUpdater.logger;

  autoUpdater.on("checking-for-update", () => {
    setState({ phase: "checking", error: null });
  });
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    setState({
      phase: "available",
      updateVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate ?? null,
      lastCheckedAt: Date.now(),
      error: null,
    });
  });
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    setState({
      phase: "not-available",
      updateVersion: null,
      releaseNotes: null,
      releaseDate: info.releaseDate ?? null,
      progressPercent: 0,
      lastCheckedAt: Date.now(),
      error: null,
    });
  });
  autoUpdater.on("download-progress", (p) => {
    setState({
      phase: "downloading",
      progressPercent: Math.round(p.percent),
    });
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    setState({
      phase: "downloaded",
      updateVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate ?? null,
      progressPercent: 100,
      error: null,
    });
  });
  autoUpdater.on("error", (err) => {
    setState({
      phase: "error",
      error: friendlyUpdaterError(err),
    });
  });

  // Initial check shortly after startup, then once an hour while the app
  // stays open. Failures are non-fatal — `error` event handles them.
  setTimeout(() => {
    checkForUpdates({ silent: true }).catch(() => {});
  }, 5_000);
  setInterval(
    () => {
      checkForUpdates({ silent: true }).catch(() => {});
    },
    60 * 60 * 1000,
  );
}

export function getUpdaterState(): UpdaterState {
  return state;
}

/**
 * Trigger a feed check. `silent` distinguishes the periodic background check
 * from a user-invoked "Check for Updates…" — only the latter should toggle
 * the renderer into the visible "checking" state.
 */
export async function checkForUpdates(options?: {
  silent?: boolean;
}): Promise<UpdaterState> {
  if (!app.isPackaged) {
    setState({ phase: "not-available", lastCheckedAt: Date.now() });

    return state;
  }
  if (!options?.silent) {
    setState({ phase: "checking", error: null });
  }
  try {
    await pointFeed();
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({
      phase: "error",
      error: friendlyUpdaterError(err),
    });
  }

  return state;
}

function friendlyUpdaterError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // electron-updater dumps the full HTTP response (status + headers) into
  // err.message on feed failures. Strip everything after the first newline
  // and collapse common cases into something users can act on.
  const firstLine = raw.split("\n")[0]?.trim() ?? raw;

  if (/\b404\b/.test(firstLine)) {
    return "No releases found. The update feed may be unavailable or this build isn't published yet.";
  }
  if (/\b(401|403)\b/.test(firstLine)) {
    return "Update feed rejected the request. Check your network or authentication.";
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(firstLine)) {
    return "Couldn't reach the update server. Check your internet connection.";
  }

  // Fall back to the first line — short enough to fit a dialog without
  // dumping response headers.
  return firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
}

/** Force a download even when autoDownload is disabled. */
export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) {
    return;
  }
  await autoUpdater.downloadUpdate();
}

/** Quit and install the downloaded update. Caller's responsibility to confirm. */
export function quitAndInstallUpdate(): void {
  if (!app.isPackaged || state.phase !== "downloaded") {
    return;
  }
  // On macOS Squirrel.Mac drives the install by closing the BrowserWindow
  // rather than firing `before-quit`. Our window close handler hides on
  // darwin unless `isQuitting` is set, so flag it now or the install no-ops.
  onBeforeQuitAndInstall?.();
  // `isSilent=false` so the user sees the installer; `isForceRunAfter=true`
  // so Argus relaunches automatically once it finishes.
  autoUpdater.quitAndInstall(false, true);
}
