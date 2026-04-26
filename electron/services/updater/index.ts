/**
 * Auto-update orchestration. Wraps `electron-updater` with the small set of
 * states the renderer actually needs to drive the home banner, the menu bar
 * "Check for Updates…" item, and the "Update ready — restart now?" prompt.
 *
 * Update feed is configured in `electron-builder.release.yml` (publish: generic
 * pointing at houwert.dev/argus/updates). Only runs in packaged builds.
 */

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { createLogger } from "../../../app/lib/logger";
import { broadcastToRenderers } from "../../broadcast";

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
  currentVersion: app.getVersion(),
  error: null,
  phase: "idle",
  progressPercent: 0,
  releaseNotes: null,
  releaseDate: null,
  updateVersion: null,
  lastCheckedAt: null,
};
let initialized = false;

function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch };
  broadcastToRenderers("updater:state", state);
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

  // Pin the feed to the houwert.dev reverse proxy regardless of what
  // `publish:` resolves to in the packaged app-update.yml. The Argus repo
  // on GitHub is private, so falling back to the github provider yields
  // a 404 on `releases.atom`.
  autoUpdater.setFeedURL({
    provider: "generic",
    url: "https://houwert.dev/argus/updates",
    channel: "latest",
    useMultipleRangeRequest: true,
  });

  // We surface our own "restart now / later" prompt; let electron-updater
  // download in the background but never auto-install on quit unless the
  // user explicitly asks for it.
  autoUpdater.autoDownload = true;
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
  // `isSilent=false` so the user sees the installer; `isForceRunAfter=true`
  // so Argus relaunches automatically once it finishes.
  autoUpdater.quitAndInstall(false, true);
}
