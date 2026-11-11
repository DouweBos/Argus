import { z } from "zod";
import {
  CustomRunner,
  CustomRunnerPreset,
  RegisteredRunner,
  RunnerSetupStarted,
  RunnerSetupStep,
} from "../models/llm";
import { type CommandSpec, NoParams, Void } from "./spec";

export const LLM_COMMANDS = {
  llm_list_runners: {
    tier: "admin",
    params: NoParams,
    result: z.array(RegisteredRunner),
  },
  /**
   * Re-bind one agent to another runner. Only legal while that agent has no
   * conversation yet — the host enforces it.
   */
  set_agent_runner: {
    tier: "admin",
    params: z.object({ agentId: z.string(), runnerId: z.string() }),
    result: z.null(),
  },
  /**
   * Install a runner's CLI or sign in to it, in a terminal of its own (or the
   * install page, for a CLI with no command). The runner is re-probed and
   * `llm:runners_changed` fires once the terminal exits.
   */
  llm_runner_setup: {
    tier: "admin",
    params: z.object({ runnerId: z.string(), step: RunnerSetupStep }),
    result: RunnerSetupStarted,
  },
  llm_list_custom_runners: {
    tier: "admin",
    params: NoParams,
    result: z.array(CustomRunner),
  },
  llm_list_custom_runner_presets: {
    tier: "admin",
    params: NoParams,
    result: z.array(CustomRunnerPreset),
  },
  /** Insert or replace a custom runner; an entry without an id gets one. */
  llm_save_custom_runner: {
    tier: "admin",
    params: z.object({ runner: CustomRunner.partial() }),
    result: CustomRunner,
  },
  llm_delete_custom_runner: {
    tier: "admin",
    params: z.object({ id: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
