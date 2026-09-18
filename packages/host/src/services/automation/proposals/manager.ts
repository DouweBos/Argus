/**
 * CRUD over proposals plus the in-memory cache the MCP tool and the IPC layer
 * share. Every mutation writes through and emits `proposals:changed`, so the
 * inbox on a paired Mac updates without polling.
 */

import type { CreateProposalInput, Proposal, ProposalStatus } from "./models";
import crypto from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";
import { loadProposals, saveProposals } from "./store";

let proposals: Proposal[] | null = null;

function cache(): Proposal[] {
  if (!proposals) {
    proposals = loadProposals();
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
    source_ref: input.source_ref ?? null,
    repo_root: input.repo_root ?? null,
    // P2 has no autonomy ladder, so every proposal waits for a human.
    status: "pending",
    session_id: null,
    dismissed_reason: null,
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

/** Drop every proposal belonging to an automation, e.g. when it is deleted. */
export function deleteProposalsForAutomation(automationId: string): void {
  const before = cache().length;
  proposals = cache().filter((p) => p.automation_id !== automationId);
  if (proposals.length !== before) {
    persist();
  }
}
