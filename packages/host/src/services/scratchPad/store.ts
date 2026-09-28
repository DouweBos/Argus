/**
 * Persisted scratch pads: `$ARGUS_HOME/scratch-pads.json`, one record per pad.
 * The pad's files live in its own directory under `$ARGUS_HOME/scratch-pads/`.
 */

import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { readEnvelope, writeJson } from "../automation/jsonFile";

const SCHEMA_VERSION = 1;

export interface ScratchPadRecord {
  /** Session id — stable across restarts so agent history stays attached. */
  id: string;
  display_name: string;
  /** Absolute path of the pad's working directory. */
  path: string;
  created_at: number;
  runner_id: string | null;
  model: string | null;
  /** Claude account the pad's agents use; absent follows the active one. */
  claude_account_id?: string | null;
}

export function scratchPadsFilePath(): string {
  return path.join(argusHomeDir(), "scratch-pads.json");
}

export function scratchPadDir(id: string): string {
  return path.join(argusHomeDir(), "scratch-pads", id);
}

export function loadScratchPads(): ScratchPadRecord[] {
  return readEnvelope<ScratchPadRecord>(
    scratchPadsFilePath(),
    "scratch pads",
    "scratch_pads",
    SCHEMA_VERSION,
  );
}

export function saveScratchPads(pads: ScratchPadRecord[]): void {
  writeJson(scratchPadsFilePath(), {
    version: SCHEMA_VERSION,
    scratch_pads: pads,
  });
}

/** Patch one record in place; a no-op when the pad is unknown. */
export function updateScratchPadRecord(
  id: string,
  patch: Partial<Omit<ScratchPadRecord, "id">>,
): void {
  const pads = loadScratchPads();
  const index = pads.findIndex((p) => p.id === id);
  if (index === -1) {
    return;
  }
  pads[index] = { ...pads[index], ...patch };
  saveScratchPads(pads);
}

/** Drop the record. Returns the removed pad so the caller can clean its dir. */
export function removeScratchPadRecord(id: string): ScratchPadRecord | null {
  const pads = loadScratchPads();
  const removed = pads.find((p) => p.id === id) ?? null;
  if (removed) {
    saveScratchPads(pads.filter((p) => p.id !== id));
  }

  return removed;
}
