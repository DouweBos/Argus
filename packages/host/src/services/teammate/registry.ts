/**
 * The persisted teammates, and nothing else. A leaf, so the automation
 * policy can read a duty's teammate without importing the manager.
 */

import type { Teammate } from "./models";
import { normalizeGuardrails } from "../automation/guardrails";
import { readEnvelope, writeJson } from "../automation/jsonFile";
import { teammatesFilePath } from "./paths";

const SCHEMA_VERSION = 1;

let cache: Teammate[] | null = null;

export function teammateCache(): Teammate[] {
  if (!cache) {
    cache = readEnvelope<Teammate>(
      teammatesFilePath(),
      "teammates.json",
      "teammates",
      SCHEMA_VERSION,
    );
    for (const teammate of cache) {
      teammate.guardrails = normalizeGuardrails(teammate.guardrails);
    }
  }

  return cache;
}

export function persistTeammates(): void {
  writeJson(teammatesFilePath(), {
    version: SCHEMA_VERSION,
    teammates: teammateCache(),
  });
}

/** Test seam: the next read comes off disk again. */
export function resetTeammateCache(): void {
  cache = null;
}

export function findTeammate(id: string | null | undefined): Teammate | null {
  if (!id) {
    return null;
  }

  return teammateCache().find((t) => t.id === id) ?? null;
}
