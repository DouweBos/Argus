import { defineTypedCommand } from "../services/command/registry";
import {
  gitRunnerCancel,
  gitRunnerInfo,
  gitRunnerOutput,
  gitRunnerRun,
} from "../services/gitRunner/runner";

export function registerGitRunnerCommands(): void {
  defineTypedCommand("git_runner_info", (p) => gitRunnerInfo(p.sessionId));
  defineTypedCommand("git_runner_run", (p) => gitRunnerRun(p));
  defineTypedCommand("git_runner_output", (p) =>
    gitRunnerOutput(p.outputId, p.offset),
  );
  defineTypedCommand("git_runner_cancel", (p) => gitRunnerCancel(p.runId));
}
