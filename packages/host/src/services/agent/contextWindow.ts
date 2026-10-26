import type { AgentSession } from "./models";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

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

const ONE_MILLION = 1_000_000;
const DEFAULT_WINDOW = 200_000;

let knownWindows: Map<string, number> | null = null;

function storePath(): string {
  return path.join(argusHomeDir(), "context-windows.json");
}

// Persisted, so a restart doesn't drop every agent back to a guess.
function known(): Map<string, number> {
  if (!knownWindows) {
    knownWindows = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as unknown;
      for (const [model, size] of Object.entries(raw ?? {})) {
        if (typeof size === "number" && size > 0) {
          knownWindows.set(model, size);
        }
      }
    } catch {
      // Missing or unreadable — start empty.
    }
  }

  return knownWindows;
}

/** Record what the CLI reported, so a fresh agent on the same model can show it. */
export function rememberContextWindow(model: string, size: number): void {
  const windows = known();
  if (windows.get(model) === size) {
    return;
  }
  windows.set(model, size);
  fs.promises
    .writeFile(storePath(), JSON.stringify(Object.fromEntries(windows)))
    .catch(() => undefined);
}

export function knownContextWindow(model?: string | null): number | null {
  return (model && known().get(model)) || null;
}

/**
 * Before the CLI has reported: `[1m]` variants and the Claude 5 family run a
 * 1M window, older Claude models 200k. Null for anything that isn't Claude.
 */
export function guessContextWindow(model?: string | null): number | null {
  if (!model) {
    return null;
  }
  if (/\[1m\]/i.test(model)) {
    return ONE_MILLION;
  }
  const major = /^claude-(?:[a-z]+-)?(\d+)/i.exec(model)?.[1];
  if (!major) {
    return null;
  }

  return Number(major) >= 5 ? ONE_MILLION : DEFAULT_WINDOW;
}

/** What the agent's CLI reported, else what that model last reported, else a guess. */
export function agentContextWindow(a: AgentSession): number | null {
  // An alias (`opus`, `default`) resolves through the CLI's own model list.
  const alias = a.handle
    ?.initializeResponse()
    ?.models.find((m) => m.value === (a.model ?? "default"))?.resolvedModel;
  const model = a.resolvedModel ?? alias ?? a.model;

  return (
    a.contextWindow ?? knownContextWindow(model) ?? guessContextWindow(model)
  );
}
