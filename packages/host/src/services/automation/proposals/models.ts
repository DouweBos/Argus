/**
 * Proposals — the unit Argus puts in front of you.
 *
 * A run's agent emits them through the `emit_proposal` MCP tool; they land in
 * the inbox and you either start one or dismiss it. In P2 every proposal is
 * `pending`: the autonomy ladder that can turn one into `auto_started` arrives
 * with the guardrail gate.
 */

export type ProposalStatus =
  | "accepted"
  | "auto_started"
  | "dismissed"
  | "pending";

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
  source_ref: ProposalSourceRef | null;
  repo_root: string | null;
  status: ProposalStatus;
  /** Set once the proposal is started — the session doing the work. */
  session_id: string | null;
  /** Why it was dismissed. The training signal; kept verbatim. */
  dismissed_reason: string | null;
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
  source_ref?: ProposalSourceRef | null;
  repo_root?: string | null;
}
