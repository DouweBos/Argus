/**
 * How a proposal reads and what its buttons do, wherever it shows up — the
 * inbox, its own page, home — over the fields the catalog's and the gateway's
 * proposals share.
 */

import type {
  RemoteProposalCta,
  RemoteProposalStatus,
} from "@argus/remote-protocol";

export type ProposalStartStage =
  | "creating_worktree"
  | "setting_up"
  | "starting_agent";

export const PROPOSAL_START_STAGE_LABELS: Record<ProposalStartStage, string> = {
  creating_worktree: "Creating worktree…",
  setting_up: "Running setup…",
  starting_agent: "Starting agent…",
};

export interface DecidedProposal {
  status: RemoteProposalStatus;
  dismissed_reason?: string | null;
  resolved_note?: string | null;
  cleared_reason?: string | null;
}

/**
 * What happened to a proposal nobody can act on any more, or null while it is
 * still waiting. A withdrawal names the automation: it was Argus's call, not
 * yours, and the reason is the evidence it had.
 */
export function decidedNote(
  proposal: DecidedProposal,
  automationName: string | null | undefined,
): string | null {
  const by = automationName || "the automation";
  const cleared = proposal.cleared_reason;
  switch (proposal.status) {
    case "pending":
      return null;
    case "accepted":
      return "You started this. It is in the session below.";
    case "auto_started":
      return "Argus started this itself — the guardrails allowed it.";
    case "dismissed":
      return proposal.dismissed_reason
        ? `You dismissed this: ${proposal.dismissed_reason}`
        : "You dismissed this.";
    case "resolved":
      return proposal.resolved_note
        ? `You marked this done: ${proposal.resolved_note}`
        : "You marked this done — you handled it yourself.";
    case "superseded":
      return `A later run of ${by} proposed the same work again${cleared ? `: ${cleared}` : "."}`;
    case "withdrawn":
      return `${by} withdrew this${cleared ? `: ${cleared}` : " — the signal behind it went away."}`;
  }
}

/** The one thing a proposal's primary button does, before anyone wires it. */
export type ProposalPrimary =
  | { kind: "destroy"; label: string; confirm: string }
  | { kind: "open"; label: string; url: string }
  | { kind: "start"; label: string };

type Cta = Pick<
  RemoteProposalCta,
  "branch" | "force" | "kind" | "label" | "url"
>;

/**
 * The CTA the run wrote, or null when there is nothing to press but dismiss.
 * `failed` turns a start into a retry.
 */
export function proposalPrimary(
  cta: Cta | null,
  failed = false,
): ProposalPrimary | null {
  if (!cta) {
    return null;
  }
  switch (cta.kind) {
    case "start_session":
      return { kind: "start", label: failed ? "Try again" : cta.label };
    case "delete_branch":
      return {
        kind: "destroy",
        label: cta.label,
        confirm: `${cta.force ? "git branch -D" : "git branch -d"} ${cta.branch ?? ""} — commits only on this branch are gone for good.`,
      };
    case "delete_session":
      return {
        kind: "destroy",
        label: cta.label,
        confirm:
          "The worktree and anything uncommitted in it are deleted. The branch is left alone.",
      };
    case "open_url":
      return cta.url ? { kind: "open", label: cta.label, url: cta.url } : null;
  }
}

/** Where a start is, or why the last one failed — for the card to show. */
export function proposalStartState(
  proposal: {
    start_error: string | null;
    start_stage: ProposalStartStage | null;
  },
  local: { refusal?: string | null; requesting?: boolean } = {},
): { error?: { detail: string; title: string }; progress?: string } {
  if (proposal.start_stage) {
    return { progress: PROPOSAL_START_STAGE_LABELS[proposal.start_stage] };
  }
  if (local.requesting) {
    return { progress: "Starting…" };
  }
  // The host's reason is already trimmed to the part that matters.
  const detail = proposal.start_error ?? local.refusal;

  return detail ? { error: { title: "Couldn't start.", detail } } : {};
}
