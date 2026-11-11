/** One model call's tokens, from whichever runner made it. */
export interface UsageRecord {
  /** Unix ms. */
  at: number;
  /** Runner id: `claude-code`, `codex`, an ACP preset or a custom runner. */
  runner: string;
  model: string;
  sessionId: string;
  /** Dedupe key for records a source can repeat; null when it never does. */
  key: string | null;
  /** Uncached input. */
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  /** Dollars the runner itself reported; null to price the tokens from the list. */
  costUsd: number | null;
}

export const CLAUDE_RUNNER_ID = "claude-code";

export const tokenCount = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
