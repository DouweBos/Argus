/**
 * A user's own ACP agent from `~/.argus/custom-runners.json`: the generic ACP
 * runner, started with the command they gave instead of a built-in preset.
 */

import type { CustomAcpAgent, CustomRunner } from "../../customRunners/store";
import type {
  LlmRunnerHandle,
  LlmRunnerSpawnArgs,
  OneShotArgs,
  RunnerModelOption,
} from "../types";
import type { AcpPreset } from "./preset";
import { AcpRunner } from "./runner";

export class CustomAcpRunner extends AcpRunner {
  readonly isCustom = true;
  readonly baseRunnerId = "acp";

  constructor(
    private readonly config: CustomRunner,
    acp: CustomAcpAgent,
  ) {
    super(customAcpPreset(config, acp));
  }

  models(): RunnerModelOption[] {
    return this.config.models.map((m) => ({
      value: m.id,
      displayName: m.displayName,
      ...(m.description ? { description: m.description } : {}),
    }));
  }

  defaultModel(): string | null {
    return this.config.defaultModel;
  }

  async spawn(args: LlmRunnerSpawnArgs): Promise<LlmRunnerHandle> {
    return super.spawn({
      ...args,
      model: args.model ?? this.config.defaultModel,
    });
  }

  async oneShot(args: OneShotArgs): Promise<string | null> {
    return super.oneShot({
      ...args,
      model: args.model ?? this.config.defaultModel ?? undefined,
    });
  }
}

export function customAcpPreset(
  config: CustomRunner,
  acp: CustomAcpAgent,
): AcpPreset {
  return {
    id: config.id,
    displayName: config.displayName,
    bins: [acp.command],
    args: acp.args,
    installHint:
      acp.installHint ?? `Check that \`${acp.command}\` is on your PATH.`,
    loginHint:
      acp.loginHint ?? `Sign in to ${config.displayName} in a terminal first.`,
    env: config.env,
  };
}
