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
  /** Globs no auto-started branch may touch, e.g. `["infra/**"]`. */
  path_denylist: string[];
  /** Gates `auto_merge`: CI must be green before the merge is allowed. */
  require_clean_ci: boolean;
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
  /** How far a run may go on its own. Null inherits the app-wide default. */
  autonomy: AutonomyLevel | null;
  /** Limits enforced in Node, never in the prompt. */
  guardrails: AutomationGuardrails;
  /** Model id for the run's agent; null inherits the app default. */
  model: string | null;
  /** Built-in template this was seeded from, for upgrade-on-release. */
  template_id: string | null;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  /** Next scheduled fire, epoch ms. Null for manual triggers. */
  next_run_at: number | null;
}

export type RunStatus =
  | "cancelled"
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";

/** One firing of an automation. */
export interface AutomationRun {
  id: string;
  automation_id: string;
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
  autonomy?: AutonomyLevel | null;
  guardrails?: Partial<AutomationGuardrails>;
  model?: string | null;
  template_id?: string | null;
}

/** Fields accepted when patching an automation. */
export type UpdateAutomationInput = Partial<
  Omit<Automation, "created_at" | "id" | "updated_at">
>;
