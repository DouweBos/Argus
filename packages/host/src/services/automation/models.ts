/**
 * Data types for automations — persisted "when X, do Y" objects and the runs
 * they produce.
 *
 * P1 deliberately carries only the clock: a `schedule` or `manual` trigger, a
 * playbook, and a report. The autonomy ladder, guardrails, signal sources and
 * proposals arrive with later phases; leaving them out keeps a run's blast
 * radius at zero.
 */

import type { ReportBlock } from "@argus/remote-protocol";

/** What causes an automation to fire. */
export type AutomationTrigger =
  | {
      kind: "schedule";
      /** 5-field cron: `min hour dom mon dow`. See `cron.ts`. */
      cron: string;
      /** IANA zone the cron fields are interpreted in, e.g. `Europe/Amsterdam`. */
      timezone: string;
      /**
       * Fire once after the host was asleep through one or more due times.
       * Missed fires always coalesce into a single run — never a backfill.
       */
      catch_up: boolean;
    }
  | { kind: "manual" };

export type AutomationTriggerKind = AutomationTrigger["kind"];

/**
 * The autonomy ladder. Each rung strictly contains the one before it; the
 * ladder order lives in `AUTONOMY_LEVELS` (`guardrails.ts`), not here.
 */
export type AutonomyLevel =
  | "auto_merge" // pr + merge when CI is green (never a default)
  | "draft" // create the worktree, implement, commit — then stop
  | "pr" // draft + push + open a draft PR
  | "propose"; // write a proposal into the inbox; touch nothing

/** The limits a run is held to, whatever its playbook says. */
export interface AutomationGuardrails {
  /** 0..1. A proposal below this never auto-starts. */
  confidence_threshold: number;
  /** Auto-started sessions this automation may have in flight at once. */
  max_concurrent_sessions: number;
  /** Post-condition: a branch touching more files than this cannot be pushed. */
  max_files_changed: number;
  /** Ceiling on a single run's spend. */
  max_cost_usd_per_run: number;
  /** Wall-clock ceiling on a single run. A run past this is abandoned. */
  max_run_minutes: number;
  /** Globs no auto-started branch may touch, e.g. `["infra/**"]`. */
  path_denylist: string[];
  /** Gates `auto_merge`: CI must be green before the merge is allowed. */
  require_clean_ci: boolean;
  /** Rerun on the next signed-in Claude account when a plan limit is hit. */
  retry_other_accounts: boolean;
}

/** A persisted automation. */
export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Repos the run may read. Registered with MCP before the agent starts. */
  scope: { repo_roots: string[] };
  /** Signal sources feeding the run, by id. Empty = the run gets no signals. */
  source_ids: string[];
  /** The instructions handed to the run's agent. Markdown. */
  playbook: string;
  /**
   * The user's own additions, appended after the playbook on every run. Kept
   * apart so a built-in's playbook stays stock and keeps taking updates.
   */
  extra_instructions: string;
  /** How far a run may go on its own. Null inherits the app-wide default. */
  autonomy: AutonomyLevel | null;
  /** Limits enforced in Node, never in the prompt. */
  guardrails: AutomationGuardrails;
  /** Model id for the run's agent; null inherits the app default. */
  model: string | null;
  /** Runner id for the run's agent; null inherits the app default. */
  runner: string | null;
  /**
   * Claude account the run is pinned to; null follows the active account. A
   * pinned run never falls back to another account. Ignored on custom runners.
   */
  claude_account_id: string | null;
  /** Built-in template this was seeded from, for upgrade-on-release. */
  template_id: string | null;
  /**
   * Hash of the playbook as seeded. Still matching means nobody edited it, so
   * a new release may replace it. Null on user-made automations.
   */
  seeded_playbook_hash: string | null;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  /** Next scheduled fire, epoch ms. Null for manual triggers. */
  next_run_at: number | null;
}

/**
 * The one-off spec behind an ad-hoc run — a playbook and a scope, run once,
 * with no `Automation` persisted for it.
 *
 * It is carried on the run record rather than in `automations.json`, and
 * `getAutomation` synthesizes an `Automation` from it on demand. That keeps the
 * autonomy ladder, the gate, the shell guard and the spend ceilings reading the
 * exact same shape they read for a scheduled run.
 */
export interface ScratchSpec {
  name: string;
  playbook: string;
  scope: { repo_roots: string[] };
  source_ids: string[];
  model: string | null;
  guardrails: AutomationGuardrails;
}

/** Fields accepted when starting an ad-hoc run. */
export interface StartScratchRunInput {
  name?: string;
  playbook: string;
  repo_roots?: string[];
  source_ids?: string[];
  model?: string | null;
  guardrails?: Partial<AutomationGuardrails>;
}

export type RunStatus =
  | "cancelled"
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";

/**
 * A note the user left on a finished run's report, and what it was allowed to
 * do about it. Kept on the run so the report says what was argued with.
 */
export interface RunFeedbackNote {
  id: string;
  /** The user's words, verbatim. */
  note: string;
  /**
   * The user let this turn withdraw or supersede proposals. False — the
   * default — means the run may only add to the inbox, never take from it.
   */
  allow_clearing: boolean;
  created_at: number;
}

/** One firing of an automation. */
export interface AutomationRun {
  id: string;
  /** For an ad-hoc run this is the synthetic id of its {@link scratch} spec. */
  automation_id: string;
  /** Set only on an ad-hoc run: the one-off spec no automation backs. */
  scratch: ScratchSpec | null;
  status: RunStatus;
  /** Human-readable cause: `"manual"`, `"schedule 07:30"`, `"catch-up"`. */
  trigger_reason: string;
  started_at: number;
  finished_at: number | null;
  /** The `automation_host` session the run's agent lives in. */
  host_session_id: string | null;
  host_agent_id: string | null;
  cost_usd: number | null;
  /** The agent's final message, rendered as plain markdown. */
  report_markdown: string | null;
  /** Structured blocks from `emit_report`. Preferred over the markdown. */
  report_blocks: ReportBlock[] | null;
  /** Failure message, or — for a `skipped` run — why it did not fire. */
  error: string | null;
  /**
   * False until the run has been acknowledged — its report looked at, a newer
   * report superseding it, or the run dismissed from the inbox.
   */
  report_read: boolean;
  /** What the user pushed back on after reading the report, oldest first. */
  feedback: RunFeedbackNote[];
}

/** Fields accepted when creating an automation. */
export interface CreateAutomationInput {
  name: string;
  description?: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  scope?: { repo_roots: string[] };
  source_ids?: string[];
  playbook: string;
  extra_instructions?: string;
  autonomy?: AutonomyLevel | null;
  guardrails?: Partial<AutomationGuardrails>;
  model?: string | null;
  runner?: string | null;
  claude_account_id?: string | null;
  template_id?: string | null;
}

/**
 * Fields accepted when patching an automation. `seeded_playbook_hash` is
 * derived state the host owns — letting a caller set it would let an edited
 * playbook pass itself off as stock and be overwritten by the next release.
 */
export type UpdateAutomationInput = Partial<
  Omit<Automation, "created_at" | "id" | "seeded_playbook_hash" | "updated_at">
>;

/** Same kinds Claude Code's own memory uses. */
export const MEMORY_TYPES = [
  "user",
  "feedback",
  "project",
  "reference",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** One file in an automation's memory directory, carried across runs. */
export interface AutomationMemory {
  /** Kebab-case slug; also the file name without `.md`. */
  name: string;
  /** One line, shown in `MEMORY.md` so a run can tell whether to open it. */
  description: string;
  type: MemoryType;
  body: string;
  updated_at: number;
}

export interface SaveMemoryInput {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  /** Set when an edit renamed the memory, so the old file goes away. */
  previous_name?: string | null;
}
