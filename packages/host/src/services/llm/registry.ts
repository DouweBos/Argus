/**
 * Runner registry.
 *
 * Today the registry holds a single {@link ClaudeCodeRunner}; future runners
 * register themselves at module load. The agent service resolves a runner
 * by id (or falls back to the only registered one) without importing
 * runner-specific modules.
 */

import type { LlmRunner, RunnerOnboardingStep } from "./runners/types";
import { warn } from "@argus/host/logger";
import { listCustomRunners } from "./customRunners/store";
import { ClaudeCodeRunner } from "./runners/claudeCode/runner";
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
 * Collect the onboarding steps every registered runner contributes, in
 * registration order. The renderer maps each step's `kind` to a concrete
 * component.
 */
export function listRunnerOnboardingSteps(): RunnerOnboardingStep[] {
  const steps: RunnerOnboardingStep[] = [];
  for (const runner of runners.values()) {
    const fn = runner.getOnboardingSteps;
    if (!fn) {
      continue;
    }
    for (const step of fn.call(runner)) {
      steps.push(step);
    }
  }

  return steps;
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

// Register built-in runners on module load, then layer the user's on top.
registerRunner(new ClaudeCodeRunner());
syncCustomRunners();
