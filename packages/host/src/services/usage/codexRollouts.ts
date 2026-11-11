/**
 * Token usage from Codex's own session rollouts (`$CODEX_HOME/sessions` and
 * `archived_sessions`), so Codex work outside Argus and before this shipped
 * counts too. `token_count` events carry cumulative totals with no model; the
 * model comes from the latest `turn_context`.
 */

import os from "node:os";
import path from "node:path";
import { JsonlScanner, listJsonl } from "./jsonlScan";
import { tokenCount, type UsageRecord } from "./records";

export const CODEX_RUNNER_ID = "codex";

interface Totals {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

export interface CodexScanState {
  sessionId: string;
  model: string;
  previous: Totals | null;
  /** Last per-request usage seen, for rollouts without cumulative totals. */
  lastSignature: string | null;
  /** A fork opens with its parent's history copied in one burst; that burst isn't new spend. */
  forkAnchor: number | null;
}

/** Copied fork history lands within milliseconds; a real model turn takes seconds. */
const FORK_BURST_MS = 1000;

export const initialCodexState = (): CodexScanState => ({
  sessionId: "",
  model: "",
  previous: null,
  lastSignature: null,
  forkAnchor: null,
});

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function readTotals(v: unknown): Totals | null {
  if (!isRecord(v) || typeof v.input_tokens !== "number") {
    return null;
  }

  return {
    input: tokenCount(v.input_tokens),
    cached: tokenCount(v.cached_input_tokens),
    cacheWrite: tokenCount(v.cache_write_input_tokens),
    output: tokenCount(v.output_tokens),
  };
}

const minus = (a: Totals, b: Totals): Totals => ({
  input: Math.max(0, a.input - b.input),
  cached: Math.max(0, a.cached - b.cached),
  cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
  output: Math.max(0, a.output - b.output),
});

function record(
  state: CodexScanState,
  at: number,
  t: Totals,
): UsageRecord | null {
  if (t.input + t.output === 0) {
    return null;
  }
  // OpenAI counts cached tokens inside input; records keep them apart.
  const cacheRead = Math.min(t.cached, t.input);
  const cacheWrite = Math.min(t.cacheWrite, t.input - cacheRead);

  return {
    at,
    runner: CODEX_RUNNER_ID,
    model: state.model || "codex",
    sessionId: state.sessionId,
    key: null,
    input: t.input - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite5m: cacheWrite,
    cacheWrite1h: 0,
    output: t.output,
    costUsd: null,
  };
}

export function parseCodexLine(
  line: string,
  state: CodexScanState,
): UsageRecord | null {
  if (
    !line.includes('"token_count"') &&
    !line.includes('"turn_context"') &&
    !line.includes('"session_meta"')
  ) {
    return null;
  }
  let rec: Json;
  try {
    rec = JSON.parse(line) as Json;
  } catch {
    return null;
  }
  const payload = isRecord(rec.payload) ? rec.payload : null;
  if (!payload) {
    return null;
  }
  const at =
    typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
  if (rec.type === "session_meta") {
    state.sessionId = typeof payload.id === "string" ? payload.id : "";
    if (typeof payload.forked_from_id === "string") {
      state.forkAnchor = Number.isFinite(at) ? at : 0;
    }

    return null;
  }
  if (rec.type === "turn_context") {
    if (typeof payload.model === "string" && payload.model) {
      state.model = payload.model;
    }

    return null;
  }
  if (rec.type !== "event_msg" || payload.type !== "token_count") {
    return null;
  }
  const info = isRecord(payload.info) ? payload.info : null;
  if (!info || !Number.isFinite(at)) {
    return null;
  }
  const total = readTotals(info.total_token_usage);
  const last = readTotals(info.last_token_usage);
  if (state.forkAnchor !== null) {
    if (at - state.forkAnchor < FORK_BURST_MS) {
      state.forkAnchor = at;
      state.previous = total ?? state.previous;

      return null;
    }
    state.forkAnchor = null;
  }
  if (total) {
    const prev = state.previous;
    state.previous = total;
    if (!prev) {
      return record(state, at, total);
    }
    // Counters restarted (a compacted or resumed thread): what's new is the last request.
    if (total.input + total.output < prev.input + prev.output) {
      return last ? record(state, at, last) : null;
    }

    return record(state, at, minus(total, prev));
  }
  if (!last) {
    return null;
  }
  // Older rollouts repeat the same `last_token_usage` while nothing new ran.
  const signature = JSON.stringify(last);
  if (signature === state.lastSignature) {
    return null;
  }
  state.lastSignature = signature;

  return record(state, at, last);
}

export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
}

const scanner = new JsonlScanner(parseCodexLine, initialCodexState);

/** Every record from rollouts written to at or after `sinceMs`. */
export async function loadCodexUsageRecords(
  sinceMs: number,
  home = codexHome(),
): Promise<UsageRecord[]> {
  const isRollout = (name: string) =>
    name.startsWith("rollout-") && name.endsWith(".jsonl");
  const found = await listJsonl(path.join(home, "sessions"), [], isRollout);
  await listJsonl(path.join(home, "archived_sessions"), found, isRollout);

  return scanner.records(found.filter((f) => f.mtimeMs >= sinceMs));
}

/** Test seam. */
export function resetCodexUsageCache(): void {
  scanner.reset();
}
