/**
 * Proposals — the unit Argus puts in front of you.
 *
 * A run's agent emits them through the `emit_proposal` MCP tool; they land in
 * the inbox and you either start one or dismiss it. In P2 every proposal is
 * `pending`: the autonomy ladder that can turn one into `auto_started` arrives
 * with the guardrail gate.
 *
 * A later run can also clear one it raised itself — `superseded` when it
 * re-proposes the same work, `withdrawn` when the signal behind it is gone —
 * so an inbox nobody emptied does not fill up with the same thing daily.
 */

export type ProposalStatus =
  | "accepted"
  | "auto_started"
  | "dismissed"
  | "pending"
  | "superseded"
  | "withdrawn";

/**
 * What the proposal's primary button does. `start_session` is the only kind
 * that spins up a worktree — everything else sends the user somewhere.
 */
export type ProposalCtaKind = "open_url" | "start_session";

/** The one action the proposal is asking for, as rendered in the inbox. */
export interface ProposalCta {
  kind: ProposalCtaKind;
  /** Button text, written by the run: "Start", "Open PR #6478". */
  label: string;
  /** Where `open_url` goes. Null for `start_session`. */
  url: string | null;
}

export type ProposalAction =
  | "ignore"
  | "needs_info"
  | "review"
  | "start_session";

/** Where the proposal came from, when it maps to an external work item. */
export interface ProposalSourceRef {
  source_id: string;
  external_id: string;
  url: string;
}

export interface Proposal {
  id: string;
  run_id: string;
  automation_id: string;
  title: string;
  summary: string;
  /** 0..1, self-reported by the agent. */
  confidence: number;
  rationale: string;
  recommended_action: ProposalAction;
  /** Primary action. Null when the only thing to do is read it and dismiss. */
  cta: ProposalCta | null;
  source_ref: ProposalSourceRef | null;
  repo_root: string | null;
  status: ProposalStatus;
  /** Set once the proposal is started — the session doing the work. */
  session_id: string | null;
  /** Why it was dismissed. The training signal; kept verbatim. */
  dismissed_reason: string | null;
  /**
   * Why a later run cleared it, in the run's words. Separate from
   * `dismissed_reason` so calibration keeps quoting the user, not the machine.
   */
  cleared_reason: string | null;
  /** When a later run cleared it. Null while nobody has. */
  cleared_at: number | null;
  /** The proposal that replaced this one, for `superseded`. */
  superseded_by: string | null;
  created_at: number;
}

/** What `emit_proposal` accepts. */
export interface CreateProposalInput {
  run_id: string;
  automation_id: string;
  title: string;
  summary: string;
  confidence: number;
  rationale: string;
  recommended_action: ProposalAction;
  /** Omit to let Argus derive one from the action and the source ref. */
  cta?: ProposalCtaInput | null;
  source_ref?: ProposalSourceRef | null;
  repo_root?: string | null;
}

/** A proposal a run cleared, and why — what the tools hand back. */
export interface ClearedProposal {
  id: string;
  title: string;
  status: Extract<ProposalStatus, "superseded" | "withdrawn">;
  reason: string | null;
}

/** What `emit_proposal` accepts for the CTA — `url` optional, unvalidated. */
export interface ProposalCtaInput {
  kind: ProposalCtaKind;
  label: string;
  url?: string | null;
}
