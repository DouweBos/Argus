/**
 * The autonomy gate, as code.
 *
 * Everything here is pure: rung comparison, guardrail defaults, and the two
 * decisions a run can be refused on — starting a session (pre-condition) and
 * pushing or merging one (post-conditions against the files it actually
 * changed). The callers live in `autonomy.ts` and the MCP layer; keeping the
 * arithmetic here is what makes the gate a `Node` if rather than a paragraph
 * the model can reinterpret.
 */

import type { AutomationGuardrails, AutonomyLevel } from "./models";
import { globMatch } from "../agent/allowRules";

/** Ascending. Index is the rung; each level contains the one before it. */
export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  "propose",
  "draft",
  "pr",
  "auto_merge",
];

export const DEFAULT_AUTONOMY: AutonomyLevel = "propose";

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return (
    typeof value === "string" &&
    (AUTONOMY_LEVELS as readonly string[]).includes(value)
  );
}

export function autonomyRank(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(level);
}

/** True when `level` is at least `minimum` on the ladder. */
export function atLeastAutonomy(
  level: AutonomyLevel,
  minimum: AutonomyLevel,
): boolean {
  return autonomyRank(level) >= autonomyRank(minimum);
}

/**
 * The lowest of the levels given — a repo may always cap itself below the app
 * default, never above it. Unknown or absent values are ignored, so a missing
 * project ceiling is "no opinion" rather than "unrestricted".
 */
export function minAutonomy(
  ...levels: (AutonomyLevel | null | undefined)[]
): AutonomyLevel {
  let lowest: AutonomyLevel | null = null;
  for (const level of levels) {
    if (!isAutonomyLevel(level)) {
      continue;
    }
    if (!lowest || autonomyRank(level) < autonomyRank(lowest)) {
      lowest = level;
    }
  }

  return lowest ?? DEFAULT_AUTONOMY;
}

export const DEFAULT_GUARDRAILS: AutomationGuardrails = {
  confidence_threshold: 0.8,
  max_concurrent_sessions: 2,
  max_files_changed: 25,
  // Off. A spend ceiling is a decision about your own money, so it is one you
  // make per automation in the editor, not one Argus makes for you.
  max_cost_usd_per_run: 0,
  path_denylist: [],
  require_clean_ci: true,
};

/**
 * The ceiling every automation used to be created with, back when the field
 * was not editable in the app. Anything still carrying it was given it rather
 * than choosing it, so {@link migrateSpendCeiling} clears it once.
 */
export const LEGACY_DEFAULT_MAX_COST_USD = 5;

/**
 * Turn the old imposed ceiling off, once, in place. A number that is not the
 * old default was picked by hand and is left alone. Returns true when it
 * changed something, so the caller knows to persist.
 */
export function migrateSpendCeiling(guardrails: AutomationGuardrails): boolean {
  if (guardrails.max_cost_usd_per_run !== LEGACY_DEFAULT_MAX_COST_USD) {
    return false;
  }
  guardrails.max_cost_usd_per_run = 0;

  return true;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function globList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

/** Fill a partial (or absent, or hand-edited) guardrail block with defaults. */
export function normalizeGuardrails(input: unknown): AutomationGuardrails {
  const raw = (input ?? {}) as Partial<AutomationGuardrails>;

  return {
    confidence_threshold: Math.min(
      1,
      Math.max(
        0,
        positiveNumber(
          raw.confidence_threshold,
          DEFAULT_GUARDRAILS.confidence_threshold,
        ),
      ),
    ),
    max_concurrent_sessions: Math.floor(
      positiveNumber(
        raw.max_concurrent_sessions,
        DEFAULT_GUARDRAILS.max_concurrent_sessions,
      ),
    ),
    max_files_changed: Math.floor(
      positiveNumber(
        raw.max_files_changed,
        DEFAULT_GUARDRAILS.max_files_changed,
      ),
    ),
    max_cost_usd_per_run: positiveNumber(
      raw.max_cost_usd_per_run,
      DEFAULT_GUARDRAILS.max_cost_usd_per_run,
    ),
    path_denylist: globList(raw.path_denylist) ?? [],
    require_clean_ci:
      typeof raw.require_clean_ci === "boolean"
        ? raw.require_clean_ci
        : DEFAULT_GUARDRAILS.require_clean_ci,
  };
}

/** A gate answer. `reason` is always set, including when it allows. */
export interface GateDecision {
  allowed: boolean;
  reason: string;
}

export interface AutoStartInput {
  recommendedAction: string;
  confidence: number;
  repoRoot: string | null;
  autonomy: AutonomyLevel;
  guardrails: AutomationGuardrails;
  /** Auto-started sessions this automation already has in flight. */
  activeForAutomation: number;
  /** Auto-started sessions in flight across every automation. */
  activeTotal: number;
  /** App-wide cap on concurrent automation sessions. */
  maxTotalSessions: number;
  /**
   * Why spend forbids more work — the run's own ceiling or the daily budget.
   * Null when there is room. Resolved by the caller from live spend.
   */
  costBlock?: string | null;
}

/**
 * Whether a proposal may start its own session. Order matters only for the
 * message: any single failure keeps the proposal pending.
 */
export function evaluateAutoStart(input: AutoStartInput): GateDecision {
  if (input.recommendedAction !== "start_session") {
    return {
      allowed: false,
      reason: `recommended_action is "${input.recommendedAction}", not "start_session"`,
    };
  }
  if (!atLeastAutonomy(input.autonomy, "draft")) {
    return {
      allowed: false,
      reason: `autonomy is "${input.autonomy}"; starting a session needs at least "draft"`,
    };
  }
  if (!input.repoRoot) {
    return {
      allowed: false,
      reason: "the proposal names no project to work in",
    };
  }
  if (input.confidence < input.guardrails.confidence_threshold) {
    return {
      allowed: false,
      reason: `confidence ${input.confidence} is below the threshold ${input.guardrails.confidence_threshold}`,
    };
  }
  if (input.activeForAutomation >= input.guardrails.max_concurrent_sessions) {
    return {
      allowed: false,
      reason: `this automation already has ${input.activeForAutomation} session(s) in flight (max ${input.guardrails.max_concurrent_sessions})`,
    };
  }
  if (input.costBlock) {
    return { allowed: false, reason: input.costBlock };
  }
  if (input.activeTotal >= input.maxTotalSessions) {
    return {
      allowed: false,
      reason: `${input.activeTotal} automation session(s) are already running (app max ${input.maxTotalSessions})`,
    };
  }

  return { allowed: true, reason: "guardrails cleared" };
}

/** Paths in `paths` matched by any glob in `denylist`. */
export function deniedPaths(paths: string[], denylist: string[]): string[] {
  return paths.filter((p) =>
    denylist.some((pattern) => globMatch(pattern, p.replace(/^\.\//, ""))),
  );
}

export interface PushCheckInput {
  autonomy: AutonomyLevel;
  guardrails: AutomationGuardrails;
  /** Repo-relative paths the session touched, from `list_session_changes`. */
  changedPaths: string[];
}

/**
 * The post-conditions. A run that cleared the gate at proposal time can still
 * be refused here, because what it actually changed is only knowable now.
 */
export function evaluatePush(input: PushCheckInput): GateDecision {
  if (!atLeastAutonomy(input.autonomy, "pr")) {
    return {
      allowed: false,
      reason: `autonomy is "${input.autonomy}"; pushing needs at least "pr"`,
    };
  }
  if (input.changedPaths.length === 0) {
    return { allowed: false, reason: "the session has no changes to push" };
  }
  if (input.changedPaths.length > input.guardrails.max_files_changed) {
    return {
      allowed: false,
      reason: `${input.changedPaths.length} files changed, over the limit of ${input.guardrails.max_files_changed}`,
    };
  }
  const denied = deniedPaths(
    input.changedPaths,
    input.guardrails.path_denylist,
  );
  if (denied.length > 0) {
    return {
      allowed: false,
      reason: `changes touch denied paths: ${denied.slice(0, 5).join(", ")}`,
    };
  }

  return { allowed: true, reason: "post-conditions cleared" };
}

export interface MergeCheckInput {
  autonomy: AutonomyLevel;
  guardrails: AutomationGuardrails;
  /** Null when CI state could not be determined — treated as not clean. */
  ciClean: boolean | null;
}

export function evaluateMerge(input: MergeCheckInput): GateDecision {
  if (!atLeastAutonomy(input.autonomy, "auto_merge")) {
    return {
      allowed: false,
      reason: `autonomy is "${input.autonomy}"; merging needs "auto_merge"`,
    };
  }
  if (input.guardrails.require_clean_ci && input.ciClean !== true) {
    return {
      allowed: false,
      reason:
        input.ciClean === null
          ? "CI status could not be determined and require_clean_ci is on"
          : "CI is not green",
    };
  }

  return { allowed: true, reason: "merge conditions cleared" };
}
