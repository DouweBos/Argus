import { z } from "zod";

export const ProposalStatus = z.enum([
  "accepted",
  "auto_started",
  "dismissed",
  "pending",
  /** The user did what it asked, outside Argus. Agreement, not rejection. */
  "resolved",
  /** Replaced by a later run of the same automation. */
  "superseded",
  /** Taken out of the inbox by a later run: the signal behind it went away. */
  "withdrawn",
]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

/**
 * What the proposal's primary button does. `start_session` spins up a
 * worktree, `open_url` sends the user somewhere, and the two `delete_` kinds
 * carry out a cleanup — destructive, so always confirmed first.
 */
export const ProposalCtaKind = z.enum([
  "delete_branch",
  "delete_session",
  "open_url",
  "start_session",
]);
export type ProposalCtaKind = z.infer<typeof ProposalCtaKind>;

/** The one action a proposal is asking for, as rendered in the inbox. */
export const ProposalCta = z.object({
  kind: ProposalCtaKind,
  /** Button text, written by the run: "Start", "Open PR #6478". */
  label: z.string(),
  /** Where `open_url` goes. Null for every other kind. */
  url: z.string().nullable(),
  /** Branch a `delete_branch` clears, in the proposal's own project. */
  branch: z.string().nullable(),
  /** `git branch -D` rather than `-d`. Only ever what the run asked for. */
  force: z.boolean(),
  /** Session a `delete_session` retires. Its branch is left alone. */
  session_id: z.string().nullable(),
});
export type ProposalCta = z.infer<typeof ProposalCta>;

export const ProposalAction = z.enum([
  "ignore",
  "needs_info",
  "review",
  "start_session",
]);
export type ProposalAction = z.infer<typeof ProposalAction>;

/** The work item a proposal came from, when it has one. */
export const ProposalSourceRef = z.object({
  /** Signal source that produced it, e.g. `github`. */
  source_id: z.string(),
  /** Id within the source, e.g. `acme/app#412`. */
  external_id: z.string(),
  url: z.string(),
});
export type ProposalSourceRef = z.infer<typeof ProposalSourceRef>;

/** Where a start is while it builds the session, in order. */
export const ProposalStartStage = z.enum([
  "creating_worktree",
  "setting_up",
  "starting_agent",
]);
export type ProposalStartStage = z.infer<typeof ProposalStartStage>;

/** One thing an automation run wants you to do. */
export const Proposal = z.object({
  id: z.string(),
  run_id: z.string(),
  automation_id: z.string(),
  title: z.string(),
  /** What the work is, in markdown. */
  summary: z.string(),
  /** 0..1, self-reported by the agent. */
  confidence: z.number(),
  /** Why the run ranked it where it did. */
  rationale: z.string(),
  /** What the run thinks should happen. */
  recommended_action: ProposalAction,
  /** Primary action. Null when the only thing to do is read it and dismiss. */
  cta: ProposalCta.nullable(),
  source_ref: ProposalSourceRef.nullable(),
  /** Project the work would happen in. Null when it maps to no local repo. */
  repo_root: z.string().nullable(),
  status: ProposalStatus,
  /** Set once the proposal is started — the session doing the work. */
  session_id: z.string().nullable(),
  /** The agent working it, once it is running. */
  agent_id: z.string().nullable(),
  /** Non-null only while a start is in flight. */
  start_stage: ProposalStartStage.nullable(),
  /** Why the last start failed, readable. Cleared when a start begins. */
  start_error: z.string().nullable(),
  /** Why it was dismissed. The training signal; kept verbatim. */
  dismissed_reason: z.string().nullable(),
  /** What the user said when they marked it done. Kept verbatim. */
  resolved_note: z.string().nullable(),
  /** When the user marked it done. Null while nobody has. */
  resolved_at: z.number().nullable(),
  /** What the user added when they started it. Goes into the agent's brief. */
  accepted_note: z.string().nullable(),
  /**
   * The user wants this proposal reworked rather than started or dismissed.
   * Handed to the next run, which supersedes it. Null once a run was asked.
   */
  revision_request: z.string().nullable(),
  /** When the revision was asked for, so a stale ask is visible as stale. */
  revision_requested_at: z.number().nullable(),
  /** Why a later run cleared it, in the run's words. */
  cleared_reason: z.string().nullable(),
  /** When a later run cleared it. Null while nobody has. */
  cleared_at: z.number().nullable(),
  /** The proposal that replaced this one, for `superseded`. */
  superseded_by: z.string().nullable(),
  created_at: z.number(),
});
export type Proposal = z.infer<typeof Proposal>;

/** What accepting a proposal produced. */
export const AcceptProposalResult = z.object({
  proposal: Proposal,
  session_id: z.string(),
  agent_id: z.string(),
});
export type AcceptProposalResult = z.infer<typeof AcceptProposalResult>;

/** What asking for a better proposal produced. */
export const RequestRevisionResult = z.object({
  proposal: Proposal,
  /** False when no run was started — the note waits for the next one. */
  run_started: z.boolean(),
});
export type RequestRevisionResult = z.infer<typeof RequestRevisionResult>;
