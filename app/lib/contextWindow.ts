import type { TokenUsage } from "./types";

const DEFAULT_CONTEXT = 200_000;
const ONE_MILLION_CONTEXT = 1_000_000;

/** Matches a 1M-context advertisement in model id or capability metadata. */
const ONE_MILLION_HINT = /\[1m\]|\b1\s*m(?:illion)?\s*context\b/i;

/**
 * Best-effort max context-window size (in tokens) for a Claude model.
 *
 * Older Claude Code releases marked 1M-context variants with a `[1m]` suffix
 * on the model id (e.g. `claude-opus-4-7[1m]`). Newer models (e.g. Opus 4.8)
 * default to a 1M window with no suffix, so the id alone is no longer enough —
 * we also inspect the capability metadata (`displayName`/`description`), which
 * advertises "1M context" for those models. Everything else is 200k.
 */
export function contextLimitForModel(
  modelId?: string | null,
  modelInfo?: { description?: string; displayName?: string } | null,
): number {
  const haystack = [
    modelId ?? "",
    modelInfo?.displayName ?? "",
    modelInfo?.description ?? "",
  ].join(" ");

  if (ONE_MILLION_HINT.test(haystack)) {
    return ONE_MILLION_CONTEXT;
  }

  return DEFAULT_CONTEXT;
}

/**
 * Total tokens currently resident in the context window, derived from the
 * usage object attached to the most recent assistant turn. All four fields
 * from the Anthropic usage record are summed since cache_read and
 * cache_creation tokens are still in-context — they're just priced differently.
 */
export function tokensInContext(usage?: TokenUsage | null): number {
  if (!usage) {
    return 0;
  }

  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.output_tokens ?? 0)
  );
}

/** Compact human-readable token count (e.g. 48k, 1.2M). */
export function formatTokenCount(n: number): string {
  if (n < 1_000) {
    return `${n}`;
  }
  if (n < 1_000_000) {
    const k = n / 1_000;

    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const m = n / 1_000_000;

  return `${m.toFixed(2).replace(/\.?0+$/, "")}M`;
}
