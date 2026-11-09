/**
 * Turns a repo's Conductor (conductor.build) scripts into `.argus.json`
 * setup and run entries, for people moving their projects over.
 *
 * Conductor reads `.conductor/settings.toml` (+ a personal
 * `settings.local.toml` on top) and falls back to the legacy `conductor.json`
 * only when the TOML file is absent.
 */

import type { ArgusConfigSuggestion } from "./types";
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { capture } from "../telemetry/telemetry";
import { suggestArgusJson } from "./argusJson";

export type ConductorConfigFormat = "conductor_json" | "settings_toml";

export interface ConductorAction {
  title: string;
  command: string;
  cwd?: string;
}

export interface ConductorScripts {
  format: ConductorConfigFormat;
  setup: string | null;
  archive: string | null;
  runMode: string | null;
  run: ConductorAction[];
  /** `[environment_variables]` from the committed settings file only. */
  env: Record<string, string>;
}

export interface ConductorImport {
  format: ConductorConfigFormat;
  suggestion: ArgusConfigSuggestion;
  /** What couldn't be carried over, worded for the user. */
  notes: string[];
}

/** Workspace env var each session's `CONDUCTOR_PORT` is derived from. */
export const PORT_SLOT_ENV = "CONDUCTOR_PORT_SLOT";
const PORT_BASE = 55000;
/** Conductor gives every workspace ten ports: `CONDUCTOR_PORT` … `+9`. */
const PORTS_PER_WORKSPACE = 10;

type Table = Record<string, unknown>;

function isTable(v: unknown): v is Table {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function readToml(file: string): Table | null {
  try {
    return parseToml(fs.readFileSync(file, "utf8")) as Table;
  } catch {
    return null;
  }
}

function readJson(file: string): Table | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));

    return isTable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function titleFor(id: string): string {
  const words = id.split(/[-_\s]+/).filter(Boolean);

  return words.length
    ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : id;
}

function runsLocally(availableIn: unknown): boolean {
  if (availableIn == null) {
    return true;
  }
  const where = Array.isArray(availableIn) ? availableIn : [availableIn];

  return where.includes("local");
}

/** `scripts.run`: a legacy single command, or a table of named actions. */
function readRunActions(run: unknown): ConductorAction[] {
  const single = str(run);
  if (single) {
    return [{ title: "Run", command: single }];
  }
  if (!isTable(run)) {
    return [];
  }
  const actions: { action: ConductorAction; isDefault: boolean }[] = [];
  for (const [id, raw] of Object.entries(run)) {
    if (!isTable(raw) || !runsLocally(raw.available_in)) {
      continue;
    }
    const command = str(raw.command);
    if (!command) {
      continue;
    }
    const args = Array.isArray(raw.args)
      ? raw.args.filter((a): a is string => typeof a === "string")
      : [];
    const cwd = isTable(raw.options) ? str(raw.options.cwd) : null;
    actions.push({
      action: {
        title: titleFor(id),
        command: [command, ...args.map(shellQuote)].join(" "),
        ...(cwd && cwd !== "." ? { cwd } : {}),
      },
      isDefault: raw.default === true,
    });
  }
  // The default action goes first: Argus's run menu leads with it.
  actions.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  return actions.map((a) => a.action);
}

function readEnv(env: unknown): Record<string, string> {
  if (!isTable(env)) {
    return {};
  }
  const out: Record<string, string> = {};
  const add = (table: Table) => {
    for (const [k, v] of Object.entries(table)) {
      if (
        /^[A-Za-z_]\w*$/.test(k) &&
        (typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean")
      ) {
        out[k] = String(v);
      }
    }
  };
  add(env);
  if (isTable(env.local)) {
    add(env.local);
  }

  return out;
}

/** The repo's Conductor scripts, or null when it has no Conductor config. */
export function readConductorScripts(
  repoRoot: string,
): ConductorScripts | null {
  const shared = readToml(path.join(repoRoot, ".conductor", "settings.toml"));
  if (shared) {
    const local = readToml(
      path.join(repoRoot, ".conductor", "settings.local.toml"),
    );
    const sharedScripts = isTable(shared.scripts) ? shared.scripts : {};
    const localScripts = isTable(local?.scripts) ? local.scripts : {};
    const run =
      isTable(sharedScripts.run) && isTable(localScripts.run)
        ? { ...sharedScripts.run, ...localScripts.run }
        : (localScripts.run ?? sharedScripts.run);
    const scripts: Table = { ...sharedScripts, ...localScripts, run };

    return {
      format: "settings_toml",
      setup: str(scripts.setup),
      archive: str(scripts.archive),
      runMode: str(scripts.run_mode),
      run: readRunActions(scripts.run),
      // Never the local file's: that's where Conductor tells people to keep secrets.
      env: readEnv(shared.environment_variables),
    };
  }
  const legacy = readJson(path.join(repoRoot, "conductor.json"));
  if (!legacy) {
    return null;
  }
  const scripts = isTable(legacy.scripts) ? legacy.scripts : {};

  return {
    format: "conductor_json",
    setup: str(scripts.setup),
    archive: str(scripts.archive),
    runMode: str(legacy.runScriptMode),
    run: readRunActions(scripts.run),
    env: {},
  };
}

/** The branch Conductor would call the default, from `origin/HEAD`. */
function defaultBranch(repoRoot: string): string {
  try {
    const head = fs.readFileSync(
      path.join(repoRoot, ".git", "refs", "remotes", "origin", "HEAD"),
      "utf8",
    );
    const m = /refs\/remotes\/origin\/(.+)/.exec(head.trim());
    if (m) {
      return m[1];
    }
  } catch {
    // No remote HEAD recorded.
  }

  return "main";
}

const TOPLEVEL = "$(git rev-parse --show-toplevel)";

/** Shell definitions for the Conductor variables Argus can reproduce. */
function conductorVar(name: string, branch: string): string | null {
  switch (name) {
    case "CONDUCTOR_WORKSPACE_PATH":
      return `"${TOPLEVEL}"`;
    case "CONDUCTOR_WORKSPACE_NAME":
      return `"$(basename "${TOPLEVEL}")"`;
    case "CONDUCTOR_ROOT_PATH":
      return `"$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`;
    case "CONDUCTOR_DEFAULT_BRANCH":
      return shellQuote(branch);
    case "CONDUCTOR_IS_LOCAL":
      return "1";
    case "CONDUCTOR_PORT":
      return `"$((${PORT_BASE} + \${${PORT_SLOT_ENV}:-0} * ${PORTS_PER_WORKSPACE}))"`;
    default:
      return null;
  }
}

interface Converted {
  command: string;
  usesPort: boolean;
  unsupported: string[];
}

/**
 * One line Argus can run as a setup step or run command: the variables the
 * script expects exported in front, multi-line scripts folded into `bash -c`
 * (setup feeds its shell one line at a time).
 */
export function convertCommand(
  script: string,
  env: Record<string, string>,
  branch: string,
): Converted {
  const body = script.trim();
  const used = [...new Set(body.match(/\bCONDUCTOR_[A-Z_]+\b/g) ?? [])].sort();
  const exports: string[] = Object.entries(env).map(
    ([k, v]) => `${k}=${shellQuote(v)}`,
  );
  const unsupported: string[] = [];
  for (const name of used) {
    const value = conductorVar(name, branch);
    if (value) {
      exports.push(`${name}=${value}`);
    } else {
      unsupported.push(name);
    }
  }
  const line = body.includes("\n")
    ? `bash -c $'${body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`
    : body;

  return {
    command: exports.length ? `export ${exports.join(" ")}; ${line}` : line,
    usesPort: used.includes("CONDUCTOR_PORT"),
    unsupported,
  };
}

/**
 * The `.argus.json` Argus would infer for the repo, with Conductor's setup
 * script and run actions in place of the guessed ones. Null without a
 * Conductor config.
 */
export function importConductorConfig(
  repoRoot: string,
): ConductorImport | null {
  const scripts = readConductorScripts(repoRoot);
  if (!scripts) {
    return null;
  }
  const suggestion = suggestArgusJson(repoRoot);
  const config = { ...suggestion.config };
  const branch = defaultBranch(repoRoot);
  const notes: string[] = [];
  const unsupported = new Set<string>();
  let usesPort = false;
  const convert = (script: string) => {
    const c = convertCommand(script, scripts.env, branch);
    usesPort ||= c.usesPort;
    c.unsupported.forEach((v) => unsupported.add(v));

    return c.command;
  };

  if (scripts.setup) {
    const setup = config.setup as { commands: string[] };
    config.setup = { ...setup, commands: [convert(scripts.setup)] };
  }
  if (scripts.run.length) {
    config.run = scripts.run.map((a) => ({
      title: a.title,
      command: convert(a.command),
      ...(a.cwd ? { cwd: a.cwd } : {}),
      restartOnRerun: true,
    }));
  }
  if (usesPort) {
    config.workspace_env = [
      ...(config.workspace_env as unknown[]),
      {
        name: PORT_SLOT_ENV,
        base_value: 0,
        range: 100,
        strategy: "sequential",
      },
    ];
  }

  if (scripts.archive) {
    notes.push(
      "The archive script isn't imported: Argus has no step that runs when a session is deleted.",
    );
  }
  if (scripts.runMode === "nonconcurrent") {
    notes.push(
      "Run actions no longer stop each other when one starts; each one restarts itself when run again.",
    );
  }
  if (unsupported.size) {
    notes.push(
      `Argus doesn't set ${[...unsupported].join(", ")}; scripts that read ${unsupported.size === 1 ? "it" : "them"} need a change.`,
    );
  }

  const file =
    scripts.format === "settings_toml"
      ? ".conductor/settings.toml"
      : "conductor.json";
  capture("conductor_config_imported", {
    format: scripts.format,
    has_setup: Boolean(scripts.setup),
    run_count: scripts.run.length,
    note_count: notes.length,
  });

  return {
    format: scripts.format,
    notes,
    suggestion: {
      config,
      inferredFrom: [file, ...suggestion.inferredFrom],
      signals: [
        { label: "Conductor", detail: file, kind: "tooling" },
        ...suggestion.signals,
      ],
    },
  };
}
