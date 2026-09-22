/**
 * CRUD over proposals plus the in-memory cache the MCP tool and the IPC layer
 * share. Every mutation writes through and emits `proposals:changed`, so the
 * inbox on a paired Mac updates without polling.
 */

import type {
  ClearedProposal,
  CreateProposalInput,
  Proposal,
  ProposalStatus,
} from "./models";
import crypto from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";
import { resolveCta } from "./cta";
import { loadProposals, saveProposals } from "./store";

let proposals: Proposal[] | null = null;

function cache(): Proposal[] {
  if (!proposals) {
    // Proposals written before the CTA and the clearing fields existed still
    // have to render a button and answer to the same shape.
    proposals = loadProposals().map((p) => ({
      ...p,
      cta: resolveCta(p.cta, p),
      cleared_reason: p.cleared_reason ?? null,
      cleared_at: p.cleared_at ?? null,
      superseded_by: p.superseded_by ?? null,
      accepted_note: p.accepted_note ?? null,
      revision_request: p.revision_request ?? null,
      revision_requested_at: p.revision_requested_at ?? null,
      resolved_note: p.resolved_note ?? null,
      resolved_at: p.resolved_at ?? null,
    }));
  }

  return proposals;
}

/** Test seam: drop the cache so the next read comes off disk again. */
export function resetProposalCache(): void {
  proposals = null;
}

function persist(): void {
  proposals = saveProposals(cache());
  emitHostEvent("proposals:changed", listProposals());
}

/** Newest first. Optionally narrowed to one automation or one run. */
export function listProposals(filter?: {
  automationId?: string;
  runId?: string;
  status?: ProposalStatus;
}): Proposal[] {
  return cache()
    .filter(
      (p) =>
        (!filter?.automationId || p.automation_id === filter.automationId) &&
        (!filter?.runId || p.run_id === filter.runId) &&
        (!filter?.status || p.status === filter.status),
    )
    .sort((a, b) => b.created_at - a.created_at)
    .map((p) => ({ ...p }));
}

export function getProposal(id: string): Proposal | null {
  const found = cache().find((p) => p.id === id);

  return found ? { ...found } : null;
}

export function requireProposal(id: string): Proposal {
  const found = cache().find((p) => p.id === id);
  if (!found) {
    throw `Proposal not found: ${id}`;
  }

  return found;
}

/** Clamp to 0..1: the agent reports confidence, so it cannot be trusted raw. */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function createProposal(input: CreateProposalInput): Proposal {
  const proposal: Proposal = {
    id: crypto.randomUUID(),
    run_id: input.run_id,
    automation_id: input.automation_id,
    title: input.title.trim(),
    summary: input.summary.trim(),
    confidence: clampConfidence(input.confidence),
    rationale: input.rationale.trim(),
    recommended_action: input.recommended_action,
    cta: resolveCta(input.cta, {
      recommended_action: input.recommended_action,
      repo_root: input.repo_root ?? null,
      source_ref: input.source_ref ?? null,
    }),
    source_ref: input.source_ref ?? null,
    repo_root: input.repo_root ?? null,
    // P2 has no autonomy ladder, so every proposal waits for a human.
    status: "pending",
    session_id: null,
    dismissed_reason: null,
    resolved_note: null,
    resolved_at: null,
    accepted_note: null,
    revision_request: null,
    revision_requested_at: null,
    cleared_reason: null,
    cleared_at: null,
    superseded_by: null,
    created_at: Date.now(),
  };

  cache().push(proposal);
  persist();

  return { ...proposal };
}

export function updateProposal(
  id: string,
  patch: Partial<Omit<Proposal, "automation_id" | "id" | "run_id">>,
): Proposal {
  const proposal = requireProposal(id);
  Object.assign(proposal, patch);
  persist();

  return { ...proposal };
}

/**
 * Dismiss a proposal. The reason is kept verbatim — it is the signal that
 * tells a later calibration pass why this automation guessed wrong.
 */
export function dismissProposal(id: string, reason?: string): Proposal {
  return updateProposal(id, {
    status: "dismissed",
    dismissed_reason: reason?.trim() ? reason.trim() : null,
  });
}

/**
 * Mark a proposal done: the user handled what it asked, outside Argus. It
 * leaves the inbox like a dismissal does, but it is the opposite signal —
 * the proposal was right — so it is kept apart from `dismissed_reason`.
 */
export function resolveProposal(id: string, note?: string): Proposal {
  const proposal = requireProposal(id);
  if (proposal.status !== "pending") {
    throw `Proposal ${id} is ${proposal.status}, not pending`;
  }

  return updateProposal(id, {
    status: "resolved",
    resolved_note: note?.trim() ? note.trim() : null,
    resolved_at: Date.now(),
  });
}

/**
 * Clear proposals a later run replaced. Only that automation's own pending
 * ones move: superseding is a run correcting itself, never one automation
 * deciding for another, and a proposal the user already acted on is history.
 */
export function supersedeProposals(
  ids: string[],
  replacement: Proposal,
  reason?: string,
): ClearedProposal[] {
  const cleared: ClearedProposal[] = [];
  for (const id of new Set(ids)) {
    const proposal = cache().find((p) => p.id === id);
    if (
      !proposal ||
      proposal.id === replacement.id ||
      proposal.status !== "pending" ||
      proposal.automation_id !== replacement.automation_id
    ) {
      continue;
    }
    Object.assign(proposal, {
      status: "superseded" satisfies ProposalStatus,
      superseded_by: replacement.id,
      cleared_reason: reason?.trim() || `Re-proposed as "${replacement.title}"`,
      cleared_at: Date.now(),
    });
    cleared.push({
      id: proposal.id,
      title: proposal.title,
      status: "superseded",
      reason: proposal.cleared_reason,
    });
  }
  if (cleared.length > 0) {
    persist();
  }

  return cleared;
}

/**
 * Withdraw a proposal on the user's behalf — the signal behind it is gone, so
 * asking them to decide on it is asking about nothing. Only pending proposals
 * can be withdrawn; the reason is what the inbox shows for it.
 */
export function withdrawProposal(id: string, reason: string): Proposal {
  const proposal = requireProposal(id);
  if (proposal.status !== "pending") {
    throw `Proposal ${id} is ${proposal.status}, not pending`;
  }

  return updateProposal(id, {
    status: "withdrawn",
    cleared_reason: reason.trim() || null,
    cleared_at: Date.now(),
  });
}

/** Drop every proposal one run emitted, e.g. when the run is deleted. */
export function deleteProposalsForRun(runId: string): void {
  const before = cache().length;
  proposals = cache().filter((p) => p.run_id !== runId);
  if (proposals.length !== before) {
    persist();
  }
}

/** Drop every proposal belonging to an automation, e.g. when it is deleted. */
export function deleteProposalsForAutomation(automationId: string): void {
  const before = cache().length;
  proposals = cache().filter((p) => p.automation_id !== automationId);
  if (proposals.length !== before) {
    persist();
  }
}
