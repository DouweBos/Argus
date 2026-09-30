import { defineTypedCommand } from "../services/command/registry";
import { setAgentRunner } from "../services/llm/agentRunner";
import { CUSTOM_RUNNER_PRESETS } from "../services/llm/customRunners/presets";
import { listCustomRunners } from "../services/llm/customRunners/store";
import {
  deleteCustomRunnerAndSync,
  describeRunners,
  saveCustomRunnerAndSync,
} from "../services/llm/registry";

export function registerLlmCommands(): void {
  defineTypedCommand("llm_list_runners", () => describeRunners());
  defineTypedCommand("set_agent_runner", async (p) => {
    await setAgentRunner(p.agentId, p.runnerId);

    return null;
  });
  defineTypedCommand("llm_list_custom_runners", () => listCustomRunners());
  defineTypedCommand(
    "llm_list_custom_runner_presets",
    () => CUSTOM_RUNNER_PRESETS,
  );
  defineTypedCommand("llm_save_custom_runner", (p) =>
    saveCustomRunnerAndSync(p.runner),
  );
  defineTypedCommand("llm_delete_custom_runner", (p) =>
    deleteCustomRunnerAndSync(p.id),
  );
}
