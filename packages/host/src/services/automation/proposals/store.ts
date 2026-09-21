/**
 * Persisted proposals: one versioned envelope under `$ARGUS_HOME`, capped so
 * an automation that proposes every morning cannot grow the file forever.
 */

import type { Proposal } from "./models";
import { readEnvelope, writeJson } from "../jsonFile";
import { proposalsFilePath } from "../paths";

const SCHEMA_VERSION = 1;

/** Proposals retained per automation; older ones are dropped on write. */
export const MAX_PROPOSALS_PER_AUTOMATION = 200;

interface ProposalsFile {
  version: number;
  proposals: Proposal[];
}

export function loadProposals(): Proposal[] {
  return readEnvelope<Proposal>(
    proposalsFilePath(),
    "automation-proposals.json",
    "proposals",
    SCHEMA_VERSION,
  );
}

/** Persist with retention applied; returns what is now on disk. */
export function saveProposals(proposals: Proposal[]): Proposal[] {
  const retained = applyProposalRetention(proposals);
  const file: ProposalsFile = { version: SCHEMA_VERSION, proposals: retained };
  writeJson(proposalsFilePath(), file);

  return retained;
}

/** Newest {@link MAX_PROPOSALS_PER_AUTOMATION} per automation, order kept. */
export function applyProposalRetention(proposals: Proposal[]): Proposal[] {
  const byAutomation = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    const list = byAutomation.get(proposal.automation_id) ?? [];
    list.push(proposal);
    byAutomation.set(proposal.automation_id, list);
  }

  const keep = new Set<string>();
  for (const list of byAutomation.values()) {
    list
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, MAX_PROPOSALS_PER_AUTOMATION)
      .forEach((p) => keep.add(p.id));
  }

  return proposals.filter((p) => keep.has(p.id));
}
