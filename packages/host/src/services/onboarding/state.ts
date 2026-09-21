/**
 * Persisted onboarding + defaults registry at `~/.argus/config.json`.
 *
 * Atomic writes via tmp + rename, schema versioning, graceful recovery on
 * parse failure.
 */

import type {
  OnboardingConfigFile,
  OnboardingStateData,
  OnboardingStep,
} from "./types";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { ONBOARDING_STEPS } from "./types";

const SCHEMA_VERSION = 1;

const DEFAULT_STATE: OnboardingStateData = {
  completed: false,
  version: SCHEMA_VERSION,
  lastStep: "welcome",
  skipped: [],
  completedAt: null,
};

/**
 * Absolute path to Argus's per-user state directory. Defaults to `~/.argus`
 * but can be overridden by setting `ARGUS_HOME` in the environment. Useful
 * for running a dev build alongside the production install:
 *
 *   ARGUS_HOME="$HOME/.argus-dev" pnpm dev
 *
 * Every file under this directory — `config.json`, `tools.json`, agent
 * logs, sessions, worktrees — is keyed off this single helper. Override
 * it once and the whole install switches to the parallel home.
 */
/** @deprecated Prefer `argusHomeDir` from `electron/lib/argusHome.ts` directly. */
export function argusDirPath(): string {
  return argusHomeDir();
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
    // Missing config.json — always start at welcome. The onboarding flow is
    // skippable end-to-end, so there's no reason to gate it on prior state;
    // doing so (as we used to, via detectPriorArgusState) meant anyone with
    // `projects.json`/`extensions`/`bin` silently jumped past the flow
    // and never saw it.
    return {
      onboarding: { ...DEFAULT_STATE },
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

  const onboarding: OnboardingStateData = {
    ...DEFAULT_STATE,
    ...(parsed.onboarding ?? {}),
  };
  // Older config.json files can name steps that no longer exist (tools,
  // preflight, claude_auth, …). Snap to the last step if onboarding was
  // already finished, else restart at welcome.
  if (!ONBOARDING_STEPS.includes(onboarding.lastStep)) {
    onboarding.lastStep = onboarding.completed ? "telemetry" : "welcome";
  }

  return {
    onboarding,
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
  const wasAlreadyCompleted = cfg.onboarding.completed;
  cfg.onboarding.completed = true;
  cfg.onboarding.completedAt = Date.now();
  cfg.onboarding.lastStep = "telemetry";
  saveConfig(cfg);
  if (!wasAlreadyCompleted) {
    telemetryCapture("onboarding_completed");
  }
}

export function resetOnboarding(): void {
  const cfg = loadConfig();
  cfg.onboarding = { ...DEFAULT_STATE };
  saveConfig(cfg);
}
