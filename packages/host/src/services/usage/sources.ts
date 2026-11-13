/**
 * Every usage history the summary reads. A runner listed here keeps its own
 * history, so Argus's per-turn ledger leaves it out and nothing counts twice.
 */

import { CODEX_RUNNER_ID, loadCodexUsageRecords } from "./codexRollouts";
import { loadLedgerRecords } from "./ledger";
import {
  ANTIGRAVITY_RUNNER_ID,
  loadAntigravityUsageRecords,
} from "./readers/antigravity";
import { CURSOR_RUNNER_ID, loadCursorUsageRecords } from "./readers/cursor";
import { GROK_RUNNER_ID, loadGrokUsageRecords } from "./readers/grok";
import {
  loadOpenCodeUsageRecords,
  OPENCODE_RUNNER_ID,
} from "./readers/opencode";
import { CLAUDE_RUNNER_ID, type UsageRecord } from "./records";
import { loadUsageRecords } from "./transcriptRecords";

export interface UsageSource {
  /** The built-in runner whose history this is; null for the ledger. */
  runner: string | null;
  /** Records written to at or after `sinceMs` (sources may return older ones too). */
  load: (sinceMs: number) => Promise<UsageRecord[]>;
}

export const USAGE_SOURCES: UsageSource[] = [
  { runner: CLAUDE_RUNNER_ID, load: loadUsageRecords },
  { runner: CODEX_RUNNER_ID, load: loadCodexUsageRecords },
  {
    runner: OPENCODE_RUNNER_ID,
    load: (since) => loadOpenCodeUsageRecords(since),
  },
  {
    runner: ANTIGRAVITY_RUNNER_ID,
    load: (since) => loadAntigravityUsageRecords(since),
  },
  { runner: GROK_RUNNER_ID, load: (since) => loadGrokUsageRecords(since) },
  { runner: CURSOR_RUNNER_ID, load: (since) => loadCursorUsageRecords(since) },
  { runner: null, load: () => loadLedgerRecords() },
];

/** Built-in runners whose own history the summary reads. */
export const OWN_HISTORY_RUNNERS = new Set(
  USAGE_SOURCES.flatMap((s) => (s.runner ? [s.runner] : [])),
);

export async function loadAllUsageRecords(
  sinceMs: number,
): Promise<UsageRecord[]> {
  const loaded = await Promise.all(
    USAGE_SOURCES.map((s) => s.load(sinceMs).catch(() => [])),
  );

  return loaded.flat();
}
