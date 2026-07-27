/**
 * Runtime conductor version override.
 *
 * Lets a user pin a conductor version from Settings and have Argus install it
 * into `~/.argus/conductor/<version>/` on demand — no app rebuild/release
 * required. When an override is active and installed, the CLI resolver
 * (`cli/conductor.ts`) points every conductor invocation at that tree instead
 * of the bundled `<resourcesPath>/conductor/`.
 *
 * Main is authoritative: the version is persisted at `~/.argus/conductor.json`
 * (the renderer settings store is localStorage-only and unreadable here) and
 * provisioning runs in this process. Requires `npm` on PATH — Electron's Node
 * ships no npm — plus registry access; failures fall back to the bundled
 * version and surface a status the Settings UI shows.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createLogger } from "../../../app/lib/logger";
import { broadcastToRenderers } from "../../broadcast";
import { argusHomeDir } from "../../lib/argusHome";
import { ensureArgusDir } from "../onboarding/state";
import { resolveAssetPath } from "../tools/assets";
import {
  VERSION_MARKER,
  registryInstallArgs,
  shimBinPath,
  writeShim,
} from "./install";

const execFileAsync = promisify(execFile);
const logger = createLogger("conductor:override");

/** Event emitted to renderers whenever the override status changes. */
export const CONDUCTOR_STATUS_EVENT = "conductor_status_changed";

const SCHEMA_VERSION = 1;
const INSTALL_TIMEOUT_MS = 120_000;

/** Loose semver check — enough to reject obvious garbage before hitting npm. */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type ProvisionState = "error" | "idle" | "installing" | "ready";

export interface ConductorStatus {
  /** Version pinned by the user, or null when using the bundled default. */
  overrideVersion: string | null;
  /** Version currently resolved for invocations (override when ready, else bundled). */
  activeVersion: string | null;
  /** Version baked into this app build. */
  bundledVersion: string | null;
  state: ProvisionState;
  error: string | null;
}

interface ConductorConfigFile {
  version: number;
  overrideVersion: string | null;
}

// ---------------------------------------------------------------------------
// Paths + persistence
// ---------------------------------------------------------------------------

function configFilePath(): string {
  return path.join(argusHomeDir(), "conductor.json");
}

/** Install tree for a given override version. */
function overrideDir(version: string): string {
  return path.join(argusHomeDir(), "conductor", version);
}

function readMarker(dir: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, VERSION_MARKER), "utf8").trim();
  } catch {
    return null;
  }
}

/** True when `<dir>` holds a complete install of `version` (marker + shim). */
function isInstalled(version: string): boolean {
  const dir = overrideDir(version);

  return readMarker(dir) === version && fs.existsSync(shimBinPath(dir));
}

function loadConfig(): ConductorConfigFile {
  let raw: string;
  try {
    raw = fs.readFileSync(configFilePath(), "utf8");
  } catch {
    return { version: SCHEMA_VERSION, overrideVersion: null };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConductorConfigFile>;
    const v = parsed.overrideVersion;

    return {
      version: SCHEMA_VERSION,
      overrideVersion: typeof v === "string" && VERSION_RE.test(v) ? v : null,
    };
  } catch (e) {
    logger.warn("Failed to parse conductor.json:", e);

    return { version: SCHEMA_VERSION, overrideVersion: null };
  }
}

function saveConfig(cfg: ConductorConfigFile): void {
  ensureArgusDir();
  const filePath = configFilePath();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/**
 * Directory the resolver should use, or null to fall back to the bundled tree.
 * Only set once an override version is fully installed, so a pending/failed
 * provision never breaks conductor invocations.
 */
let activeOverrideDir: string | null = null;
let overrideVersion: string | null = null;
let state: ProvisionState = "idle";
let error: string | null = null;
/** Guards against concurrent provisions of the same version. */
let inFlight: Promise<void> | null = null;

/**
 * The active override install dir, or null when the bundled conductor should
 * be used. Read synchronously by `getConductorDir()` on every invocation.
 */
export function getActiveConductorOverrideDir(): string | null {
  return activeOverrideDir;
}

/** Read the version baked into the bundled tree (its `.version` marker). */
function readBundledVersion(): string | null {
  return readMarker(resolveAssetPath("conductor"));
}

export function getConductorStatus(): ConductorStatus {
  return {
    overrideVersion,
    activeVersion:
      overrideVersion && activeOverrideDir
        ? overrideVersion
        : readBundledVersion(),
    bundledVersion: readBundledVersion(),
    state,
    error,
  };
}

function setState(next: ProvisionState, err: string | null = null): void {
  state = next;
  error = err;
  broadcastToRenderers(CONDUCTOR_STATUS_EVENT, getConductorStatus());
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

async function provision(version: string): Promise<void> {
  if (isInstalled(version)) {
    activeOverrideDir = overrideDir(version);
    setState("ready");

    return;
  }

  setState("installing");
  const dir = overrideDir(version);
  try {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Installing conductor v${version} into ${dir}`);
    await execFileAsync("npm", registryInstallArgs(version, dir), {
      timeout: INSTALL_TIMEOUT_MS,
    });
    fs.writeFileSync(path.join(dir, VERSION_MARKER), version);
    writeShim(dir);

    // Config may have changed while npm ran — only activate if still current.
    if (overrideVersion === version) {
      activeOverrideDir = dir;
      setState("ready");
      logger.info(`Conductor v${version} ready`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const hint = /ENOENT|not found|spawn npm/i.test(message)
      ? "npm not found on PATH — install Node.js/npm to use a custom conductor version."
      : message;
    logger.error(`Failed to install conductor v${version}:`, message);
    if (overrideVersion === version) {
      activeOverrideDir = null; // fall back to bundled
      setState("error", hint);
    }
  }
}

/**
 * Set (or clear, with null) the pinned conductor version and provision it.
 * Returns the resulting status. Clearing reverts to the bundled version.
 */
export async function setConductorOverrideVersion(
  version: string | null,
): Promise<ConductorStatus> {
  const trimmed = version?.trim() || null;
  if (trimmed && !VERSION_RE.test(trimmed)) {
    throw `Invalid conductor version: ${trimmed}`;
  }

  overrideVersion = trimmed;
  saveConfig({ version: SCHEMA_VERSION, overrideVersion: trimmed });

  if (!trimmed) {
    activeOverrideDir = null;
    setState("idle");

    return getConductorStatus();
  }

  inFlight = provision(trimmed);
  await inFlight;
  inFlight = null;

  return getConductorStatus();
}

/**
 * Load the persisted override on startup. If a version is pinned but not yet
 * installed, provisioning runs in the background — invocations use the bundled
 * version until it completes.
 */
export function initConductorOverride(): void {
  overrideVersion = loadConfig().overrideVersion;
  if (!overrideVersion) {
    return;
  }
  if (isInstalled(overrideVersion)) {
    activeOverrideDir = overrideDir(overrideVersion);
    setState("ready");

    return;
  }
  // Background provision; errors are captured in status, not thrown.
  const version = overrideVersion;
  inFlight = provision(version).finally(() => {
    inFlight = null;
  });
}
