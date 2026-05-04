/**
 * Runner registry.
 *
 * Today the registry holds a single {@link ClaudeCodeRunner}; future runners
 * register themselves at module load. The agent service resolves a runner
 * by id (or falls back to the only registered one) without importing
 * runner-specific modules.
 */

import type { LlmRunner, RunnerOnboardingStep } from "./runners/types";
import { ClaudeCodeRunner } from "./runners/claudeCode/runner";

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
 * Resolve the single runner Argus should use today. Phase 1 has no
 * project/app cascade — it returns the only registered runner. Phase 2
 * replaces the body with the resolver from the plan.
 */
export function resolveDefaultRunner(): LlmRunner {
  const all = [...runners.values()];
  if (all.length === 0) {
    throw "No LLM runners are registered";
  }
  if (all.length > 1) {
    // Phase 1: only Claude is registered. If multiple ever land before the
    // resolver does, pick Claude explicitly so behavior stays stable.
    const claude = runners.get("claude-code");
    if (claude) {
      return claude;
    }
  }

  return all[0]!;
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

// Register built-in runners on module load.
registerRunner(new ClaudeCodeRunner());
