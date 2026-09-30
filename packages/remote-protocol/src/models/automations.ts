import { z } from "zod";
import { ReportBlock } from "../report";

export * from "./automations/proposals";

/** What causes an automation to fire. */
export const AutomationTrigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("schedule"),
    /** 5-field cron: `min hour dom mon dow`. */
    cron: z.string(),
    /** IANA zone the cron fields are interpreted in, e.g. `Europe/Amsterdam`. */
    timezone: z.string(),
    /**
     * Fire once after the host was asleep through one or more due times.
     * Missed fires always coalesce into a single run — never a backfill.
     */
    catch_up: z.boolean(),
  }),
  z.object({ kind: z.literal("manual") }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;
export type AutomationTriggerKind = AutomationTrigger["kind"];

/**
 * The autonomy ladder. Each rung strictly contains the one before it:
 * `propose` writes a proposal and touches nothing, `draft` implements and
 * commits, `pr` also pushes a draft PR, `auto_merge` merges on green CI.
 */
export const AutonomyLevel = z.enum(["auto_merge", "draft", "pr", "propose"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

/** The limits a run is held to, enforced in the host, not in the prompt. */
export const AutomationGuardrails = z.object({
  /** 0..1. A proposal below this never auto-starts. */
  confidence_threshold: z.number(),
  /** Auto-started sessions this automation may have in flight at once. */
  max_concurrent_sessions: z.number(),
  /** Post-condition: a branch touching more files than this cannot be pushed. */
  max_files_changed: z.number(),
  /** Ceiling on a single run's spend. */
  max_cost_usd_per_run: z.number(),
  /** Wall-clock ceiling on a single run. A run past this is abandoned. */
  max_run_minutes: z.number(),
  /** Globs no auto-started branch may touch, e.g. `["infra/**"]`. */
  path_denylist: z.array(z.string()),
  /** Gates `auto_merge`: CI must be green before the merge is allowed. */
  require_clean_ci: z.boolean(),
  /** Rerun on the next signed-in Claude account when a plan limit is hit. */
  retry_other_accounts: z.boolean(),
});
export type AutomationGuardrails = z.infer<typeof AutomationGuardrails>;

const AutomationScope = z.object({ repo_roots: z.array(z.string()) });

/** A persisted "when X, do Y" object. */
export const Automation = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  trigger: AutomationTrigger,
  /** Repos the run may read. */
  scope: AutomationScope,
  /** Signal sources feeding the run, by id. Empty = the run gets no signals. */
  source_ids: z.array(z.string()),
  /** The instructions handed to the run's agent. Markdown. */
  playbook: z.string(),
  /** The user's own additions, appended after the playbook on every run. */
  extra_instructions: z.string(),
  /** How far a run may go on its own. Null inherits the app-wide default. */
  autonomy: AutonomyLevel.nullable(),
  guardrails: AutomationGuardrails,
  /** Model id for the run's agent; null inherits the app default. */
  model: z.string().nullable(),
  /** Runner id for the run's agent; null inherits the app default. */
  runner: z.string().nullable(),
  /** Built-in template this was seeded from, for upgrade-on-release. */
  template_id: z.string().nullable(),
  /**
   * Hash of the playbook as seeded. Still matching means nobody edited it, so
   * a new release may replace it. Null on user-made automations.
   */
  seeded_playbook_hash: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  last_run_at: z.number().nullable(),
  /** Next scheduled fire, epoch ms. Null for manual triggers. */
  next_run_at: z.number().nullable(),
});
export type Automation = z.infer<typeof Automation>;

/** The one-off spec behind an ad-hoc run; no automation is persisted for it. */
export const AutomationScratchSpec = z.object({
  name: z.string(),
  playbook: z.string(),
  scope: AutomationScope,
  source_ids: z.array(z.string()),
  model: z.string().nullable(),
  guardrails: AutomationGuardrails,
});
export type AutomationScratchSpec = z.infer<typeof AutomationScratchSpec>;

/** Fields accepted when starting an ad-hoc run. */
export const StartScratchRunInput = z.object({
  name: z.string().optional(),
  playbook: z.string(),
  repo_roots: z.array(z.string()).optional(),
  source_ids: z.array(z.string()).optional(),
  model: z.string().nullish(),
  guardrails: AutomationGuardrails.partial().optional(),
});
export type StartScratchRunInput = z.infer<typeof StartScratchRunInput>;

export const AutomationRunStatus = z.enum([
  "cancelled",
  "failed",
  "queued",
  "running",
  "skipped",
  "succeeded",
]);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatus>;

/** A note the user left on a run's report, and what it was allowed to do. */
export const AutomationRunFeedback = z.object({
  id: z.string(),
  /** The user's words, verbatim. */
  note: z.string(),
  /** The run could withdraw or supersede proposals while answering this. */
  allow_clearing: z.boolean(),
  created_at: z.number(),
});
export type AutomationRunFeedback = z.infer<typeof AutomationRunFeedback>;

/** One firing of an automation. */
export const AutomationRun = z.object({
  id: z.string(),
  /** For an ad-hoc run, the synthetic id of its `scratch` spec. */
  automation_id: z.string(),
  /** Set only on an ad-hoc run: the one-off spec no automation backs. */
  scratch: AutomationScratchSpec.nullable(),
  status: AutomationRunStatus,
  /** Human-readable cause: `"manual"`, `"schedule 07:30"`, `"catch-up"`. */
  trigger_reason: z.string(),
  started_at: z.number(),
  finished_at: z.number().nullable(),
  /** The `automation_host` session the run's agent lives in. */
  host_session_id: z.string().nullable(),
  host_agent_id: z.string().nullable(),
  cost_usd: z.number().nullable(),
  /** The agent's final message, rendered as plain markdown. */
  report_markdown: z.string().nullable(),
  /** Structured blocks from `emit_report`. Preferred over the markdown. */
  report_blocks: z.array(ReportBlock).nullable(),
  /** Failure message, or — for a `skipped` run — why it did not fire. */
  error: z.string().nullable(),
  /**
   * False until the run has been acknowledged — its report looked at, a newer
   * report superseding it, or the run dismissed from the inbox.
   */
  report_read: z.boolean(),
  /** What the user pushed back on after reading the report, oldest first. */
  feedback: z.array(AutomationRunFeedback),
});
export type AutomationRun = z.infer<typeof AutomationRun>;

/** Fields accepted when creating an automation. */
export const CreateAutomationInput = z.object({
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  trigger: AutomationTrigger,
  scope: AutomationScope.optional(),
  source_ids: z.array(z.string()).optional(),
  playbook: z.string(),
  extra_instructions: z.string().optional(),
  autonomy: AutonomyLevel.nullish(),
  guardrails: AutomationGuardrails.partial().optional(),
  model: z.string().nullish(),
  runner: z.string().nullish(),
  template_id: z.string().nullish(),
});
export type CreateAutomationInput = z.infer<typeof CreateAutomationInput>;

/**
 * Fields accepted when patching an automation. `seeded_playbook_hash` is host
 * state — a caller setting it could pass an edited playbook off as stock.
 */
export const UpdateAutomationInput = Automation.omit({
  created_at: true,
  id: true,
  seeded_playbook_hash: true,
  updated_at: true,
}).partial();
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInput>;

/** A drafted automation plus everything Argus had to correct about it. */
export const AutomationDraft = z.object({
  /** Ready to save — always disabled, never autonomous. */
  input: CreateAutomationInput,
  /** What was repaired or dropped, shown to the user above the draft. */
  notes: z.array(z.string()),
});
export type AutomationDraft = z.infer<typeof AutomationDraft>;

export const AutomationMemoryType = z.enum([
  "user",
  "feedback",
  "project",
  "reference",
]);
export type AutomationMemoryType = z.infer<typeof AutomationMemoryType>;

/** One file in an automation's memory directory, carried across runs. */
export const AutomationMemory = z.object({
  /** Kebab-case slug; also the file name without `.md`. */
  name: z.string(),
  /** One line, shown in `MEMORY.md` so a run can tell whether to open it. */
  description: z.string(),
  type: AutomationMemoryType,
  body: z.string(),
  updated_at: z.number(),
});
export type AutomationMemory = z.infer<typeof AutomationMemory>;

export const AutomationMemoryListing = z.object({
  /** The `MEMORY.md` index, when there is one. */
  index: z.string().nullable(),
  memories: z.array(AutomationMemory),
});
export type AutomationMemoryListing = z.infer<typeof AutomationMemoryListing>;

export const SaveAutomationMemoryInput = z.object({
  name: z.string(),
  description: z.string(),
  type: AutomationMemoryType,
  body: z.string(),
  /** Set when an edit renamed the memory, so the old file goes away. */
  previous_name: z.string().nullish(),
});
export type SaveAutomationMemoryInput = z.infer<
  typeof SaveAutomationMemoryInput
>;

/** One thing a read-only run was refused, and what would allow it. */
export const GateLogEntry = z.object({
  id: z.string(),
  automation_id: z.string(),
  automation_name: z.string(),
  run_id: z.string(),
  /** `Bash` or the MCP tool name. */
  tool_name: z.string(),
  /** The command, when it was a shell call. Null for a tool call. */
  command: z.string().nullable(),
  /** What to add to the allowlist to permit this. */
  suggested_entry: z.string(),
  /** Which list `suggested_entry` belongs in. */
  kind: z.enum(["command", "tool"]),
  first_seen_at: z.number(),
  last_seen_at: z.number(),
  /** How many times this same refusal has happened. */
  count: z.number(),
});
export type GateLogEntry = z.infer<typeof GateLogEntry>;

/** One automation's track record, as both the prompt and the UI read it. */
export const AutomationCalibration = z.object({
  automation_id: z.string(),
  /** Proposals considered — the newest twenty. */
  sample: z.number(),
  accepted: z.number(),
  auto_started: z.number(),
  dismissed: z.number(),
  pending: z.number(),
  /** The user did what it asked themselves — agreement without a session. */
  resolved: z.number(),
  /** Cleared by a later run: replaced, or withdrawn because the signal went. */
  superseded: z.number(),
  withdrawn: z.number(),
  merged: z.number(),
  abandoned: z.number(),
  reverted: z.number(),
  /**
   * Accepted + auto-started + resolved over everything decided. Null while
   * nothing has been decided.
   */
  acceptance_rate: z.number().nullable(),
  /** Verbatim dismissal reasons, newest first. The training signal. */
  dismissals: z.array(z.object({ title: z.string(), reason: z.string() })),
  /** Notes the user added when starting one. */
  accepted_notes: z.array(z.object({ title: z.string(), note: z.string() })),
});
export type AutomationCalibration = z.infer<typeof AutomationCalibration>;

/** A signal source a run can be fed from, with availability resolved. */
export const SignalSourceInfo = z.object({
  id: z.string(),
  label: z.string(),
  /** `native` = Argus fetches it; `agent` = the run's agent fetches it. */
  mode: z.enum(["agent", "native"]),
  /** False when the source has nothing to answer with — no `gh`, no MCP. */
  available: z.boolean(),
});
export type SignalSourceInfo = z.infer<typeof SignalSourceInfo>;
