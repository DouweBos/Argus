/**
 * Persisted onboarding + defaults registry at `~/.argus/config.json`.
 *
 * Pattern mirrors `electron/services/organization/store.ts` — atomic writes
 * via tmp + rename, schema versioning, graceful recovery on parse failure.
 */

import type {
  OnboardingConfigFile,
  OnboardingDefaults,
  OnboardingStateData,
  OnboardingStep,
} from "./types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "../../../app/lib/logger";

const SCHEMA_VERSION = 1;

const DEFAULT_DEFAULTS: OnboardingDefaults = {
  model: "claude-opus-4-7",
  permissionMode: "plan",
  worktreeRoot: path.join(os.homedir(), ".argus", "worktrees"),
};

const DEFAULT_STATE: OnboardingStateData = {
  completed: false,
  version: SCHEMA_VERSION,
  lastStep: "welcome",
  skipped: [],
  completedAt: null,
};

export function argusDirPath(): string {
  return path.join(os.homedir(), ".argus");
}

export function configFilePath(): string {
  return path.join(argusDirPath(), "config.json");
}

/** Ensure `~/.argus/` exists. Returns the absolute path. */
export function ensureArgusDir(): string {
  const dir = argusDirPath();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });

  return dir;
}

/** Load the config file, applying defaults + migration as needed. */
export function loadConfig(): OnboardingConfigFile {
  const filePath = configFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    // Fresh install OR upgrade from pre-onboarding Argus.
    // If `~/.argus/` already has other content (e.g. organizations.json),
    // treat as an upgrade: seed completed so we don't interrupt existing users.
    const hasPriorState = detectPriorArgusState();

    return {
      onboarding: hasPriorState
        ? {
            ...DEFAULT_STATE,
            completed: true,
            version: 0,
            completedAt: Date.now(),
          }
        : { ...DEFAULT_STATE },
      defaults: { ...DEFAULT_DEFAULTS },
      recentProjects: [],
    };
  }

  let parsed: Partial<OnboardingConfigFile>;
  try {
    parsed = JSON.parse(raw) as Partial<OnboardingConfigFile>;
  } catch (e) {
    warn("Failed to parse config.json:", e);
    parsed = {};
  }

  return {
    onboarding: {
      ...DEFAULT_STATE,
      ...(parsed.onboarding ?? {}),
    },
    defaults: {
      ...DEFAULT_DEFAULTS,
      ...(parsed.defaults ?? {}),
    },
    recentProjects: parsed.recentProjects ?? [],
  };
}

export function saveConfig(cfg: OnboardingConfigFile): void {
  ensureArgusDir();
  const filePath = configFilePath();
  const json = JSON.stringify(cfg, null, 2);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, filePath);
}

export function getOnboardingState(): OnboardingConfigFile {
  return loadConfig();
}

export function setLastStep(step: OnboardingStep): void {
  const cfg = loadConfig();
  cfg.onboarding.lastStep = step;
  saveConfig(cfg);
}

export function addSkipped(id: string): void {
  const cfg = loadConfig();
  if (!cfg.onboarding.skipped.includes(id)) {
    cfg.onboarding.skipped.push(id);
    saveConfig(cfg);
  }
}

export function saveDefaults(
  updates: Partial<OnboardingDefaults>,
): OnboardingDefaults {
  const cfg = loadConfig();
  cfg.defaults = { ...cfg.defaults, ...updates };
  saveConfig(cfg);

  return cfg.defaults;
}

export function registerProject(repoPath: string): void {
  const cfg = loadConfig();
  cfg.recentProjects = [
    repoPath,
    ...cfg.recentProjects.filter((p) => p !== repoPath),
  ].slice(0, 20);
  saveConfig(cfg);
}

export function completeOnboarding(): void {
  const cfg = loadConfig();
  cfg.onboarding.completed = true;
  cfg.onboarding.completedAt = Date.now();
  cfg.onboarding.lastStep = "completion";
  saveConfig(cfg);
}

export function resetOnboarding(): void {
  const cfg = loadConfig();
  cfg.onboarding = { ...DEFAULT_STATE };
  saveConfig(cfg);
}

/** True if `~/.argus/` already holds state from a pre-onboarding install. */
function detectPriorArgusState(): boolean {
  const dir = argusDirPath();
  try {
    const entries = fs.readdirSync(dir);
    const meaningful = entries.filter(
      (e) => e === "organizations.json" || e === "extensions" || e === "bin",
    );

    return meaningful.length > 0;
  } catch {
    return false;
  }
}
