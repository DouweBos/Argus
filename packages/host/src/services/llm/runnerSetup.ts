/**
 * Installs a runner's CLI, or signs in to it, from its greyed-out picker entry:
 * the preset's command runs in a terminal the user watches and can type into,
 * then the runner is re-probed so pickers enable it.
 */

import type {
  RunnerSetupStarted,
  RunnerSetupStep,
} from "@argus/remote-protocol";
import os from "node:os";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { TELEMETRY_RUNNERS, type TelemetryRunner } from "../../telemetryEvents";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { loginShellEnv } from "../terminal/loginEnv";
import {
  createHostTerminal,
  defaultShell,
  waitForTerminal,
} from "../terminal/multiplexer";
import { forgetRunnerAvailability, getRunnerById } from "./registry";

/** What owns setup terminals in place of a session. */
export const RUNNER_SETUP_OWNER = "runner-setup";

export async function startRunnerSetup(
  runnerId: string,
  step: RunnerSetupStep,
): Promise<RunnerSetupStarted> {
  const runner = getRunnerById(runnerId);
  const setup = runner?.setup?.();
  if (!runner || !setup) {
    throw `${runner?.displayName ?? runnerId} can't be set up from Argus.`;
  }
  const command =
    step === "install" ? setup.installCommand : setup.loginCommand;
  if (!command) {
    if (step === "install" && setup.installUrl) {
      await hostPlatform().openExternal(setup.installUrl);
      capture(runnerId, step, "opened_page");

      return { terminalId: null, openedUrl: setup.installUrl };
    }
    throw `${runner.displayName} has no ${step === "install" ? "install" : "sign-in"} command.`;
  }

  const title = `${step === "install" ? "Install" : "Sign in to"} ${runner.displayName}`;
  const terminalId = createHostTerminal(RUNNER_SETUP_OWNER, command, title);
  finish(runnerId, step, terminalId).catch((e: unknown) =>
    warn(`[runnerSetup] ${runnerId} ${step}: ${String(e)}`),
  );

  return { terminalId, openedUrl: null };
}

async function finish(
  runnerId: string,
  step: RunnerSetupStep,
  terminalId: string,
): Promise<void> {
  let exitCode: number | null = null;
  try {
    for (;;) {
      const result = await waitForTerminal(terminalId, { timeoutMs: 600_000 });
      if (result.reason === "exit") {
        exitCode = result.exitCode;
        break;
      }
    }
  } catch {
    // Closed before it exited; re-probe anyway.
  }
  if (step === "install" && exitCode === 0) {
    await refreshPath();
  }
  forgetRunnerAvailability(runnerId);
  capture(runnerId, step, exitCode === 0 ? "succeeded" : "failed");
  emitHostEvent("llm:runners_changed", { runnerId, step, exitCode });
}

/**
 * An installer that adds its bin dir in the user's rc files (Kiro, Cursor)
 * only reaches the host's PATH through a fresh login shell.
 */
async function refreshPath(): Promise<void> {
  const env = await loginShellEnv(
    defaultShell(),
    process.env as Record<string, string>,
    os.homedir(),
  );
  const fresh = env?.PATH?.split(":") ?? [];
  const current = (process.env.PATH ?? "").split(":");
  const added = fresh.filter((dir) => dir && !current.includes(dir));
  if (added.length > 0) {
    process.env.PATH = [...current, ...added].join(":");
  } else if (!env) {
    warn("[runnerSetup] couldn't read the login shell's PATH after an install");
  }
}

function capture(
  runnerId: string,
  step: RunnerSetupStep,
  outcome: "failed" | "opened_page" | "succeeded",
): void {
  const runner: TelemetryRunner =
    TELEMETRY_RUNNERS.find((id) => id === runnerId) ?? "custom";
  telemetryCapture("runner_setup", { runner, step, outcome });
}
