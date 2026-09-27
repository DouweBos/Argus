/**
 * The context window the CLI itself reports: every `result` event carries
 * `modelUsage[model].contextWindow`, which is authoritative where guessing
 * from model ids and marketing copy is not.
 */

/**
 * The main model's window from a `result` event's `modelUsage`. Subagents on
 * other models show up there too, so match `mainModel` first and otherwise
 * take the largest window reported.
 */
export function contextWindowFromModelUsage(
  modelUsage: unknown,
  mainModel?: string | null,
): number | null {
  if (!modelUsage || typeof modelUsage !== "object") {
    return null;
  }

  const windows = new Map<string, number>();
  for (const [model, usage] of Object.entries(modelUsage)) {
    const size = (usage as { contextWindow?: unknown } | null)?.contextWindow;
    if (typeof size === "number" && size > 0) {
      windows.set(model, size);
    }
  }
  if (windows.size === 0) {
    return null;
  }

  return (
    (mainModel ? windows.get(mainModel) : undefined) ??
    Math.max(...windows.values())
  );
}

const knownWindows = new Map<string, number>();

/** Record what the CLI reported, so a fresh agent on the same model can show it. */
export function rememberContextWindow(model: string, size: number): void {
  knownWindows.set(model, size);
}

export function knownContextWindow(model?: string | null): number | null {
  return (model && knownWindows.get(model)) || null;
}
