/**
 * Runner registry.
 *
 * Built-in runners (Claude Code, Codex, the ACP agents) register at module load; custom
 * runners derived from them are layered on top. The agent service resolves a runner
 * by id (or falls back to the only registered one) without importing
 * runner-specific modules.
 */

import type {
  LlmRunner,
  PreflightResult,
  RunnerCapabilities,
  RunnerModelOption,
  RunnerSetup,
} from "./runners/types";
import { warn } from "@argus/host/logger";
import {
  type CustomRunner,
  deleteCustomRunner,
  listCustomRunners,
  saveCustomRunner,
} from "./customRunners/store";
import { ACP_PRESETS } from "./runners/acp/presets";
import { AcpRunner } from "./runners/acp/runner";
import { ClaudeCodeRunner } from "./runners/claudeCode/runner";
import { CodexRunner } from "./runners/codex/runner";
import { DerivedRunner } from "./runners/derived";

const runners = new Map<string, LlmRunner>();

export function registerRunner(runner: LlmRunner): void {
  runners.set(runner.id, runner);
}

export function getRunnerById(id: string): LlmRunner | null {
  return runners.get(id) ?? null;
}

export function listRunners(): LlmRunner[] {
  return [...runners.values()];
}

/**
 * Resolve the runner for callers with no session context (preflight, title
 * generation). Prefers Claude, then any other built-in; custom runners are
 * opt-in and never picked implicitly.
 */
export function resolveDefaultRunner(): LlmRunner {
  const all = [...runners.values()];
  if (all.length === 0) {
    throw "No LLM runners are registered";
  }
  const claude = runners.get("claude-code");
  if (claude) {
    return claude;
  }

  return all.find((r) => !r.isCustom) ?? all[0]!;
}

/**
 * Re-register the user's custom runners from `~/.argus/custom-runners.json`.
 *
 * Called at boot and after every edit. Runners are re-derived wholesale so a
 * renamed or deleted entry can't linger; built-ins are never touched.
 * Sessions already bound to a removed runner fail at spawn with a clear
 * "not registered" error rather than silently switching runners.
 */
export function syncCustomRunners(): void {
  for (const [id, runner] of runners) {
    if (runner.isCustom) {
      runners.delete(id);
    }
  }

  for (const config of listCustomRunners()) {
    const base = runners.get(config.baseRunnerId);
    if (!base) {
      warn(
        `[llm] custom runner "${config.id}" derives from unknown runner "${config.baseRunnerId}" — skipping`,
      );
      continue;
    }
    registerRunner(new DerivedRunner(config, base));
  }
}

/** The subset of a runner the UI needs, flattened for the wire. */
export interface RegisteredRunner {
  id: string;
  displayName: string;
  capabilities: RunnerCapabilities;
  isCustom: boolean;
  baseRunnerId: string | null;
  models: RunnerModelOption[];
  defaultModel: string | null;
  /** False when the runner's CLI isn't installed; pickers show it disabled. */
  available?: boolean;
  /** How to install it, when unavailable. */
  unavailableReason?: string | null;
  /** How Argus installs and signs in to it; absent when it can't. */
  setup?: RunnerSetup | null;
}

export interface RunnerAvailability {
  available: boolean;
  unavailableReason: string | null;
}

/** Long enough that opening a picker twice doesn't re-probe, short enough to see an install. */
const AVAILABILITY_TTL_MS = 15_000;
const availability = new Map<
  string,
  { at: number; result: Promise<PreflightResult> }
>();

/** Drop a runner's cached probe, so the next read sees an install that just finished. */
export function forgetRunnerAvailability(runnerId: string): void {
  availability.delete(runnerId);
}

/** Whether each runner's CLI is installed, probed in parallel and cached briefly. */
export async function runnerAvailability(
  now = Date.now(),
): Promise<Map<string, RunnerAvailability>> {
  const all = listRunners();
  const results = await Promise.all(
    all.map(async (r) => {
      let entry = availability.get(r.id);
      if (!entry || now - entry.at > AVAILABILITY_TTL_MS) {
        entry = {
          at: now,
          result: r
            .preflight()
            .catch((e): PreflightResult => ({ ok: false, reason: String(e) })),
        };
        availability.set(r.id, entry);
      }

      return [r.id, await entry.result] as const;
    }),
  );

  return new Map(
    results.map(([id, result]) => [
      id,
      {
        available: result.ok,
        unavailableReason: result.ok ? null : result.reason,
      },
    ]),
  );
}

export async function describeRunners(): Promise<RegisteredRunner[]> {
  const avail = await runnerAvailability();

  return listRunners().map((r) => ({
    id: r.id,
    displayName: r.displayName,
    capabilities: r.capabilities(),
    isCustom: r.isCustom ?? false,
    baseRunnerId: r.baseRunnerId ?? null,
    models: r.models?.() ?? [],
    defaultModel: r.defaultModel?.() ?? null,
    available: avail.get(r.id)?.available ?? true,
    unavailableReason: avail.get(r.id)?.unavailableReason ?? null,
    setup: r.setup?.() ?? null,
  }));
}

/** Save a custom runner and re-sync so the picker sees it without a restart. */
export function saveCustomRunnerAndSync(
  input: Partial<CustomRunner>,
): CustomRunner {
  const saved = saveCustomRunner(input);
  syncCustomRunners();

  return saved;
}

export function deleteCustomRunnerAndSync(id: string): void {
  deleteCustomRunner(id);
  syncCustomRunners();
}

// Register built-in runners on module load, then layer the user's on top.
registerRunner(new ClaudeCodeRunner());
registerRunner(new CodexRunner());
for (const preset of ACP_PRESETS) {
  registerRunner(new AcpRunner(preset));
}
syncCustomRunners();
