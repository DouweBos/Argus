import type { TokenUsage } from "./types";

const DEFAULT_CONTEXT = 200_000;
const KNOWN_WINDOWS_KEY = "argus:context-windows";
const ONE_MILLION_CONTEXT = 1_000_000;

/** Matches a 1M-context advertisement in model id or capability metadata. */
const ONE_MILLION_HINT = /\[1m\]|\b1\s*m(?:illion)?\s*context\b/i;

interface ModelMeta {
  description?: string;
  displayName?: string;
  value?: string;
}

/**
 * Best-effort max context-window size (in tokens) for a Claude model, for
 * before the CLI has reported the real one — see `resolveContextLimit`.
 *
 * Older Claude Code releases marked 1M-context variants with a `[1m]` suffix
 * on the model id (e.g. `claude-opus-4-7[1m]`). Newer models (e.g. Opus 4.8)
 * default to a 1M window with no suffix, so the id alone is no longer enough —
 * we inspect the capability metadata (`displayName`/`description`), which
 * advertises "1M context" for those models.
 *
 * The tricky case is a resumed agent: the variant suffix (`[1m]`) is stripped
 * from the JSONL transcript, so the only model identifier we recover is the
 * resolved id (e.g. `claude-opus-4-8`), which matches no capability `value`
 * and carries no `[1m]` hint. To handle it we accept the full capability model
 * list and resolve in order:
 *   1. Exact match on the selected variant `value` → use its description.
 *   2. No match → fall back to the `default` capability entry, whose
 *      description advertises the CLI's default model + context (which is what
 *      a resumed default agent is actually running).
 * Everything else is 200k.
 */
export function contextLimitForModel(
  modelId?: string | null,
  models?: ModelMeta[] | null,
): number {
  const list = models ?? [];

  const matched = list.find((m) => m.value === modelId);
  // Only consult the `default` entry when the variant didn't match directly —
  // an explicit non-default selection (e.g. the 200k `opus`) must not inherit
  // the default's window.
  const fallback = matched ?? list.find((m) => m.value === "default");

  const haystack = [
    modelId ?? "",
    matched?.displayName ?? fallback?.displayName ?? "",
    matched?.description ?? fallback?.description ?? "",
  ].join(" ");

  if (ONE_MILLION_HINT.test(haystack)) {
    return ONE_MILLION_CONTEXT;
  }

  return DEFAULT_CONTEXT;
}

function readKnownWindows(): Record<string, number> {
  if (typeof localStorage === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(
      localStorage.getItem(KNOWN_WINDOWS_KEY) ?? "{}",
    ) as unknown;

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Remember what the CLI reported for a model, so the next agent on it shows
 * the right window before its own first turn ends — across launches too.
 */
export function rememberContextWindow(model: string, size: number): void {
  const known = readKnownWindows();
  if (known[model] === size || typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      KNOWN_WINDOWS_KEY,
      JSON.stringify({ ...known, [model]: size }),
    );
  } catch {
    // Quota / unavailable — the guess still works.
  }
}

/**
 * The window to show: what this agent's CLI reported, else what it last
 * reported for the same model, else the guess from model metadata.
 */
export function resolveContextLimit(opts: {
  models?: ModelMeta[] | null;
  reported?: number | null;
  resolvedModel?: string | null;
  selectedModel?: string | null;
}): number {
  if (opts.reported) {
    return opts.reported;
  }
  const known = opts.resolvedModel
    ? readKnownWindows()[opts.resolvedModel]
    : undefined;
  if (typeof known === "number" && known > 0) {
    return known;
  }

  return contextLimitForModel(opts.selectedModel, opts.models);
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
