/**
 * Runner derived from an official one.
 *
 * Delegates every behavior (subprocess, protocol, transcript fork,
 * capabilities) to a base runner and only overrides identity, environment,
 * and model selection. That is enough to point the Claude Code CLI at an
 * Anthropic-compatible gateway without duplicating any of its plumbing.
 *
 * Onboarding steps are deliberately not delegated: a derived runner
 * authenticates through its own env vars, not the base runner's login flow.
 */

import type {
  ForkTranscriptArgs,
  LlmRunner,
  LlmRunnerHandle,
  LlmRunnerSpawnArgs,
  OneShotArgs,
  PreflightResult,
  RunnerCapabilities,
  RunnerModelOption,
} from "./types";
import type { CustomRunner } from "../customRunners/store";

export class DerivedRunner implements LlmRunner {
  readonly id: string;
  readonly displayName: string;
  readonly baseRunnerId: string;
  readonly isCustom = true;

  constructor(
    private readonly config: CustomRunner,
    private readonly base: LlmRunner,
  ) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.baseRunnerId = base.id;
    const fork = base.forkTranscript?.bind(base);
    if (fork) {
      this.forkTranscript = (args) =>
        fork({ ...args, env: this.applyEnv(args.env ?? process.env) });
    }
  }

  capabilities(): RunnerCapabilities {
    return this.base.capabilities();
  }

  models(): RunnerModelOption[] {
    if (this.config.models.length > 0) {
      return this.config.models.map((m) => ({
        value: m.id,
        displayName: m.displayName,
        ...(m.description ? { description: m.description } : {}),
      }));
    }

    return this.base.models?.() ?? [];
  }

  defaultModel(): string | null {
    return this.config.defaultModel;
  }

  async preflight(): Promise<PreflightResult> {
    return this.base.preflight();
  }

  async spawn(args: LlmRunnerSpawnArgs): Promise<LlmRunnerHandle> {
    return this.base.spawn({
      ...args,
      model: args.model ?? this.config.defaultModel,
      env: this.applyEnv(args.env),
    });
  }

  async oneShot(args: OneShotArgs): Promise<string | null> {
    return this.base.oneShot({
      ...args,
      env: this.applyEnv(args.env ?? process.env),
      // The gateway won't have the base runner's cheap default model.
      model: args.model ?? this.config.defaultModel ?? undefined,
    });
  }

  /** Absent when the base has none, so callers fall back to a seed. */
  readonly forkTranscript?: (
    args: ForkTranscriptArgs,
  ) => Promise<{ resumeRef: string | null }>;

  async latestTranscriptRef(cwd: string): Promise<string | null> {
    return (await this.base.latestTranscriptRef?.(cwd)) ?? null;
  }

  /** Overrides win over inherited vars; an empty value unsets one. */
  private applyEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = { ...base };
    for (const [key, value] of Object.entries(this.config.env)) {
      if (value === "") {
        Reflect.deleteProperty(env, key);
      } else {
        env[key] = value;
      }
    }

    return env;
  }
}
