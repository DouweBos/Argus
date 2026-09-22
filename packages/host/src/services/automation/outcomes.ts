/**
 * What actually happened to what an automation proposed.
 *
 * `confidence` is a number the model invents until something checks it. This
 * is the check: every proposal's fate — accepted, dismissed and why,
 * auto-started — plus, for the ones that became work, whether the branch
 * merged or was abandoned. It feeds back into the next run's prompt and shows
 * up on the automation's screen, so an automation that is wrong seven times
 * out of ten is visibly wrong rather than quietly noisy.
 *
 * Proposal status already persists in `proposals/store.ts`, so only the
 * session's fate is recorded here. That half is observed off the host bus:
 * `session:merged` and `session:deleted` are emitted wherever a session ends,
 * so nothing in the session service has to know automations exist.
 */

import type { Proposal } from "./proposals/models";
import { addHostEventSink } from "@argus/host/bus";
import { readEnvelope, writeJson } from "./jsonFile";
import { outcomesFilePath } from "./paths";
import { listProposals } from "./proposals/manager";

const SCHEMA_VERSION = 1;

/** How the work a proposal started ended up. */
export type SessionOutcome = "abandoned" | "merged" | "reverted";

export interface ProposalOutcome {
  proposal_id: string;
  automation_id: string;
  session_id: string;
  outcome: SessionOutcome;
  recorded_at: number;
}

/** Proposals per automation the calibration block looks back over. */
export const CALIBRATION_WINDOW = 20;

/** Dismissal reasons quoted into the prompt. More than this is noise. */
const QUOTED_REASONS = 4;

let outcomes: ProposalOutcome[] | null = null;

function cache(): ProposalOutcome[] {
  if (!outcomes) {
    outcomes = readEnvelope<ProposalOutcome>(
      outcomesFilePath(),
      "automation-outcomes.json",
      "outcomes",
      SCHEMA_VERSION,
    );
  }

  return outcomes;
}

/** Test seam: drop the cache so the next read comes off disk again. */
export function resetOutcomeCache(): void {
  outcomes = null;
}

function persist(): void {
  writeJson(outcomesFilePath(), {
    version: SCHEMA_VERSION,
    outcomes: cache(),
  });
}

/**
 * Record how a started proposal ended. First write wins: a merged branch whose
 * worktree is later cleaned up did not get abandoned.
 */
export function recordSessionOutcome(
  sessionId: string,
  outcome: SessionOutcome,
): ProposalOutcome | null {
  if (cache().some((o) => o.session_id === sessionId)) {
    return null;
  }
  const proposal = listProposals().find((p) => p.session_id === sessionId);
  if (!proposal) {
    return null;
  }

  const record: ProposalOutcome = {
    proposal_id: proposal.id,
    automation_id: proposal.automation_id,
    session_id: sessionId,
    outcome,
    recorded_at: Date.now(),
  };
  cache().push(record);
  persist();

  return record;
}

export function listOutcomes(automationId?: string): ProposalOutcome[] {
  return cache()
    .filter((o) => !automationId || o.automation_id === automationId)
    .map((o) => ({ ...o }));
}

let detach: (() => void) | null = null;

/**
 * Start watching the bus. Idempotent, so a second call (or a test) does not
 * end up with two sinks double-counting.
 */
export function initAutomationOutcomes(): void {
  detach?.();
  detach = addHostEventSink((channel, args) => {
    if (channel === "session:merged") {
      const payload = args[0] as { sessionId?: string } | undefined;
      if (payload?.sessionId) {
        recordSessionOutcome(payload.sessionId, "merged");
      }

      return;
    }
    if (channel === "session:deleted" && typeof args[0] === "string") {
      recordSessionOutcome(args[0], "abandoned");
    }
  });
}

/** Test seam: stop watching the bus. */
export function stopAutomationOutcomes(): void {
  detach?.();
  detach = null;
}

/** One automation's track record, as both the prompt and the UI read it. */
export interface AutomationCalibration {
  automation_id: string;
  /** Proposals considered — the newest {@link CALIBRATION_WINDOW}. */
  sample: number;
  accepted: number;
  auto_started: number;
  dismissed: number;
  pending: number;
  /** Cleared by a later run: replaced, or withdrawn because the signal went. */
  superseded: number;
  withdrawn: number;
  merged: number;
  abandoned: number;
  reverted: number;
  /**
   * Accepted + auto-started over everything decided. Null while nothing has
   * been decided — a rate off zero proposals is a lie, not a zero.
   */
  acceptance_rate: number | null;
  /** Verbatim dismissal reasons, newest first. The training signal. */
  dismissals: { title: string; reason: string }[];
}

function countBy(proposals: Proposal[], status: Proposal["status"]): number {
  return proposals.filter((p) => p.status === status).length;
}

export function calibrationFor(automationId: string): AutomationCalibration {
  const proposals = listProposals({ automationId }).slice(
    0,
    CALIBRATION_WINDOW,
  );
  const ids = new Set(proposals.map((p) => p.id));
  const relevant = listOutcomes(automationId).filter((o) =>
    ids.has(o.proposal_id),
  );

  const accepted = countBy(proposals, "accepted");
  const autoStarted = countBy(proposals, "auto_started");
  const dismissed = countBy(proposals, "dismissed");
  const decided = accepted + autoStarted + dismissed;

  return {
    automation_id: automationId,
    sample: proposals.length,
    accepted,
    auto_started: autoStarted,
    dismissed,
    pending: countBy(proposals, "pending"),
    superseded: countBy(proposals, "superseded"),
    withdrawn: countBy(proposals, "withdrawn"),
    merged: relevant.filter((o) => o.outcome === "merged").length,
    abandoned: relevant.filter((o) => o.outcome === "abandoned").length,
    reverted: relevant.filter((o) => o.outcome === "reverted").length,
    acceptance_rate: decided === 0 ? null : (accepted + autoStarted) / decided,
    dismissals: proposals
      .filter((p) => p.status === "dismissed" && p.dismissed_reason)
      .slice(0, QUOTED_REASONS)
      .map((p) => ({ title: p.title, reason: p.dismissed_reason ?? "" })),
  };
}

/**
 * The calibration block for a run's prompt, or null when the automation has no
 * track record yet — a block saying "0 of 0" would only teach the model to
 * distrust a number that does not exist.
 */
export function calibrationBlock(automationId: string): string | null {
  const c = calibrationFor(automationId);
  if (c.sample === 0) {
    return null;
  }

  const lines = [
    "",
    "## Calibration",
    "",
    `Your last ${c.sample} proposal(s) for this automation: ${c.accepted} accepted, ${c.auto_started} auto-started, ${c.dismissed} dismissed, ${c.pending} still waiting.`,
  ];

  // Worth saying out loud: a run that keeps proposing what a later run has to
  // replace is generating work for itself, not for the user.
  if (c.superseded + c.withdrawn > 0) {
    lines.push(
      "",
      `${c.superseded} were superseded by a later run and ${c.withdrawn} withdrawn once the signal behind them went away.`,
    );
  }

  if (c.merged + c.abandoned + c.reverted > 0) {
    lines.push(
      "",
      `Of the ones that became work: ${c.merged} merged, ${c.abandoned} abandoned, ${c.reverted} reverted.`,
    );
  }

  if (c.dismissals.length > 0) {
    lines.push("", "Dismissed, in the user's own words:", "");
    for (const d of c.dismissals) {
      lines.push(`- "${d.title}" — ${d.reason}`);
    }
  }

  lines.push(
    "",
    c.acceptance_rate !== null && c.acceptance_rate < 0.5
      ? "Most of what you proposed was rejected. Propose less, and lower your confidence on anything resembling what was dismissed above."
      : "Weight your confidence accordingly, and do not propose anything resembling what was dismissed above.",
  );

  return lines.join("\n");
}
