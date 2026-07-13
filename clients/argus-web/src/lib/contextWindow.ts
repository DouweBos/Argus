/**
 * Context-window math for the remote chat, ported from the desktop's
 * `app/lib/contextWindow.ts`. The web client has the same model metadata
 * (displayName/description) via agent capabilities, so 1M-context detection
 * matches the desktop.
 */
import type { RemoteModelInfo, RemoteTokenUsage } from "./protocol";

const DEFAULT_CONTEXT = 200_000;
const ONE_MILLION_CONTEXT = 1_000_000;

/** Matches a 1M-context advertisement in model id or capability metadata. */
const ONE_MILLION_HINT = /\[1m\]|\b1\s*m(?:illion)?\s*context\b/i;

/** Best-effort max context-window size (tokens) for the agent's model. */
export function contextLimitForModel(
  modelId: string | null | undefined,
  models: RemoteModelInfo[],
): number {
  const matched = models.find((m) => m.value === modelId);
  const fallback = matched ?? models.find((m) => m.value === "default");
  const haystack = [
    modelId ?? "",
    matched?.displayName ?? fallback?.displayName ?? "",
    matched?.description ?? fallback?.description ?? "",
  ].join(" ");

  return ONE_MILLION_HINT.test(haystack) ? ONE_MILLION_CONTEXT : DEFAULT_CONTEXT;
}

/** Total tokens resident in context — all four usage fields are in-window. */
export function tokensInContext(usage?: RemoteTokenUsage | null): number {
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

/** Compact token count (e.g. 48k, 1.2M) for tooltips. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }

  return String(n);
}
