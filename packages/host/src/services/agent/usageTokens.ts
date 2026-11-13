/** Every token a `result` event's `usage` counts, cached reads and writes included. */
export function usageTokens(
  usage: Record<string, unknown> | undefined,
): number {
  if (!usage) {
    return 0;
  }
  let total = 0;
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ]) {
    const n = usage[key];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      total += n;
    }
  }

  return total;
}
