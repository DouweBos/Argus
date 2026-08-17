/**
 * Custom LLM runners stored at `~/.argus/custom-runners.json`.
 *
 * A custom runner derives from an official one (today only `claude-code`)
 * and overrides its environment, model list, and default model — enough to
 * point the same CLI at an Anthropic-compatible gateway (callstack.ai's
 * Apex, a proxy, a self-hosted endpoint). The file holds API tokens, so it
 * is machine-local and written 0600; `.argus.json` only references ids.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../../app/lib/logger";
import { argusHomeDir } from "../../../lib/argusHome";

const SCHEMA_VERSION = 1;

/** Reserved prefix so custom ids can never shadow a built-in runner. */
export const CUSTOM_RUNNER_ID_PREFIX = "custom:";

export interface CustomRunnerModel {
  /** Model id passed to the CLI, e.g. `callstack/Apex`. */
  id: string;
  /** Label shown in the model picker. */
  displayName: string;
  /** Optional second line in the picker. */
  description?: string;
}

export interface CustomRunner {
  /** Stable id, always `custom:<slug>`. */
  id: string;
  /** Label shown wherever runners are listed. */
  displayName: string;
  /** Official runner this one derives from, e.g. `claude-code`. */
  baseRunnerId: string;
  /**
   * Environment overrides applied on top of the base runner's env for every
   * spawn and one-shot. An empty value unsets an inherited variable.
   */
  env: Record<string, string>;
  /** Models offered in the picker. Empty falls back to the base runner's. */
  models: CustomRunnerModel[];
  /** Model used when nothing else pins one. */
  defaultModel: string | null;
}

interface CustomRunnersFile {
  version: number;
  runners: CustomRunner[];
}

function filePath(): string {
  return path.join(argusHomeDir(), "custom-runners.json");
}

function emptyFile(): CustomRunnersFile {
  return { version: SCHEMA_VERSION, runners: [] };
}

function readFile(): CustomRunnersFile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return emptyFile();
  }

  let parsed: CustomRunnersFile;
  try {
    parsed = JSON.parse(raw) as CustomRunnersFile;
  } catch (e) {
    warn("Failed to parse custom-runners.json:", e);

    return emptyFile();
  }

  if (!Array.isArray(parsed.runners)) {
    return emptyFile();
  }

  return {
    version: SCHEMA_VERSION,
    runners: parsed.runners
      .map(normalize)
      .filter((r): r is CustomRunner => r !== null),
  };
}

function writeFile(file: CustomRunnersFile): void {
  fs.mkdirSync(argusHomeDir(), { recursive: true });
  // 0600: the env map routinely holds an API token.
  fs.writeFileSync(filePath(), `${JSON.stringify(file, null, 2)}\n`, {
    mode: 0o600,
  });
}

function normalize(raw: unknown): CustomRunner | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Partial<CustomRunner>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const displayName =
    typeof r.displayName === "string" ? r.displayName.trim() : "";
  if (!id || !displayName) {
    return null;
  }

  const env: Record<string, string> = {};
  if (r.env && typeof r.env === "object") {
    for (const [key, value] of Object.entries(r.env)) {
      const name = key.trim();
      if (name && typeof value === "string") {
        env[name] = value;
      }
    }
  }

  const models: CustomRunnerModel[] = Array.isArray(r.models)
    ? r.models
        .map((m) => normalizeModel(m))
        .filter((m): m is CustomRunnerModel => m !== null)
    : [];

  const defaultModel = trimOrNull(r.defaultModel);

  return {
    id: id.startsWith(CUSTOM_RUNNER_ID_PREFIX)
      ? id
      : `${CUSTOM_RUNNER_ID_PREFIX}${id}`,
    displayName,
    baseRunnerId: trimOrNull(r.baseRunnerId) ?? "claude-code",
    env,
    models,
    defaultModel,
  };
}

function normalizeModel(raw: unknown): CustomRunnerModel | null {
  const m = (raw ?? {}) as Partial<CustomRunnerModel>;
  const id = trimOrNull(m.id);
  if (!id) {
    return null;
  }
  const description = trimOrNull(m.description);

  return {
    id,
    displayName: trimOrNull(m.displayName) ?? id,
    ...(description ? { description } : {}),
  };
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

export function listCustomRunners(): CustomRunner[] {
  return readFile().runners;
}

/** Derive `custom:<slug>` from a display name. */
export function customRunnerIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${CUSTOM_RUNNER_ID_PREFIX}${slug || "runner"}`;
}

/**
 * Insert or replace a runner. An entry without an id gets one derived from
 * its display name, de-duplicated with a numeric suffix.
 */
export function saveCustomRunner(input: Partial<CustomRunner>): CustomRunner {
  const displayName = trimOrNull(input.displayName);
  if (!displayName) {
    throw "Custom runner needs a name";
  }

  const file = readFile();
  const existingId = trimOrNull(input.id);
  const id = existingId ?? uniqueId(customRunnerIdFromName(displayName), file);

  const normalized = normalize({ ...input, id, displayName });
  if (!normalized) {
    throw "Custom runner is missing required fields";
  }

  const index = file.runners.findIndex((r) => r.id === normalized.id);
  if (index >= 0) {
    file.runners[index] = normalized;
  } else {
    file.runners.push(normalized);
  }
  writeFile(file);

  return normalized;
}

export function deleteCustomRunner(id: string): void {
  const file = readFile();
  file.runners = file.runners.filter((r) => r.id !== id);
  writeFile(file);
}

function uniqueId(base: string, file: CustomRunnersFile): string {
  if (!file.runners.some((r) => r.id === base)) {
    return base;
  }
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!file.runners.some((r) => r.id === candidate)) {
      return candidate;
    }
  }
}
