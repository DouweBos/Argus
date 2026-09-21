/**
 * LLM resolver.
 *
 * Two cascades, separated so that the runner is fixed at session creation
 * but the model stays editable per agent spawn:
 *
 * - {@link resolveRunnerForSession} — runs once at `create_session` time.
 *   Walks explicit per-session pick → project (`.argus.json` `llm.runner`) →
 *   app default → the single built-in runner. Throws when multiple runners are registered and no
 *   level chose one. The chosen runner is stamped onto `Session.runner_id`
 *   and is immutable for the session's lifetime.
 *
 * - {@link resolveModelForAgent} — runs at every agent spawn within a
 *   session. Walks agent override → session model → project default → app
 *   default → runner default (`null`, meaning "let the runner pick").
 *
 * Both functions read settings/config defensively: callers may not have
 * project- or app-level defaults wired in yet (those are tracks 2A and
 * 2B). When a level isn't supplied, we just skip it.
 */

import type { CanonicalPermissionMode, LlmRunner } from "./runners/types";
import { warn } from "@argus/host/logger";
import { getRunnerById, listRunners } from "./registry";

/**
 * Subset of {@link ArgusConfig} this module needs. Accepts a partial so
 * callers can pass `undefined` when 2B's `llm` field isn't on disk.
 */
export interface ProjectLlmConfig {
  llm?: {
    runner?: string | null;
    model?: string | null;
  } | null;
}

/**
 * App-level default LLM. Mirrors the `defaultLlm` shape from
 * `app/stores/settingsStore.ts`. Callers that haven't wired the renderer
 * setting through to the main process should pass `undefined`.
 */
export interface AppDefaultLlm {
  runner?: string | null;
  model?: string | null;
}

export interface ResolveRunnerArgs {
  /** Repo root for diagnostic messages. */
  repoRoot: string;
  /**
   * Runner/model the user picked for this session in the new-session dialog.
   * Wins over every other level — an explicit choice must not be overridden
   * by `.argus.json`.
   */
  explicit?: AppDefaultLlm;
  /** Parsed `.argus.json`. May be missing the `llm` block. */
  argusConfig?: ProjectLlmConfig;
  /** App-level default. May be undefined when settings haven't been read. */
  appDefault?: AppDefaultLlm;
}

export interface ResolveRunnerResult {
  runner: LlmRunner;
  /** Default model surfaced from the same level that picked the runner. */
  defaultModel: string | null;
}

/**
 * Pick the runner for a brand-new session. Returns the chosen runner plus
 * the default model proposed at the same level (which the caller normally
 * stamps onto `Session.model`).
 */
export function resolveRunnerForSession(
  args: ResolveRunnerArgs,
): ResolveRunnerResult {
  const explicitRunner = trimOrNull(args.explicit?.runner ?? null);
  const explicitModel = trimOrNull(args.explicit?.model ?? null);
  const projectRunner = trimOrNull(args.argusConfig?.llm?.runner ?? null);
  const projectModel = trimOrNull(args.argusConfig?.llm?.model ?? null);
  const appRunner = trimOrNull(args.appDefault?.runner ?? null);
  const appModel = trimOrNull(args.appDefault?.model ?? null);

  // 0. Explicit per-session pick.
  if (explicitRunner) {
    const runner = getRunnerById(explicitRunner);
    if (runner) {
      return { runner, defaultModel: explicitModel };
    }
    warn(
      `[llm] session runner "${explicitRunner}" is not registered — falling back to project/app default`,
    );
  }

  // 1. Project default.
  if (projectRunner) {
    const runner = getRunnerById(projectRunner);
    if (runner) {
      return { runner, defaultModel: projectModel };
    }
    warn(
      `[llm] project .argus.json llm.runner "${projectRunner}" is not a registered runner — falling back to app/default for ${args.repoRoot}`,
    );
  }

  // 2. App default.
  if (appRunner) {
    const runner = getRunnerById(appRunner);
    if (runner) {
      return { runner, defaultModel: appModel };
    }
    warn(
      `[llm] app default runner "${appRunner}" is not registered — falling back to single registered runner`,
    );
  }

  // 3. Built-in fallback. Custom runners are opt-in, so they never become an
  // implicit default — callers that don't pass an app default (the MCP
  // `create_session` tool) must still get a working session.
  const all = listRunners();
  if (all.length === 0) {
    throw "No LLM runners are registered";
  }
  const builtIns = all.filter((r) => !r.isCustom);
  if (builtIns.length === 0) {
    throw "No built-in LLM runners are registered";
  }
  if (builtIns.length > 1) {
    throw `Multiple LLM runners are registered (${builtIns
      .map((r) => r.id)
      .join(
        ", ",
      )}) but neither the project (.argus.json llm.runner) nor the app default chose one. Set llm.runner in .argus.json or the LLM section of Settings.`;
  }

  return { runner: builtIns[0]!, defaultModel: null };
}

export interface ResolveModelArgs {
  /** The session record (only `runner_id` and `model` are read). */
  session: { runner_id?: string | null; model?: string | null };
  /** Per-spawn agent override (e.g. from MCP `spawn_agent` `model` arg). */
  agentOverride?: {
    model?: string | null;
    permissionMode?: CanonicalPermissionMode | null;
  };
  /** Project default to consult after session.model. */
  argusConfig?: ProjectLlmConfig;
  /** App default to consult after the project default. */
  appDefault?: AppDefaultLlm;
  /** Runner's own default, consulted last (custom runners declare one). */
  runnerDefaultModel?: string | null;
}

export interface ResolveModelResult {
  /**
   * Resolved model id, or `null` when no level pinned one (the runner
   * picks its own default).
   */
  model: string | null;
  /**
   * Permission mode forwarded straight from `agentOverride` — included on
   * the result so callers can pass it to `runner.spawn` alongside the
   * model. `null` when no override was provided.
   */
  permissionMode: CanonicalPermissionMode | null;
}

/**
 * Pick the model for a single agent spawn. Cascade: agent override →
 * session.model → project → app → runner default → null.
 */
export function resolveModelForAgent(
  args: ResolveModelArgs,
): ResolveModelResult {
  const override = trimOrNull(args.agentOverride?.model ?? null);
  const sessionModel = trimOrNull(args.session.model ?? null);
  const projectModel = trimOrNull(args.argusConfig?.llm?.model ?? null);
  const appModel = trimOrNull(args.appDefault?.model ?? null);
  const runnerModel = trimOrNull(args.runnerDefaultModel ?? null);

  const model =
    override ?? sessionModel ?? projectModel ?? appModel ?? runnerModel ?? null;
  const permissionMode = args.agentOverride?.permissionMode ?? null;

  return { model, permissionMode };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
