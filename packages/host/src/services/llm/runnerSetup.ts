/**
 * Installs a runner's CLI, signs in to it or out of it, from its greyed-out
 * picker entry or the Accounts page: the preset's command runs in a terminal
 * the user watches and can type into, then the runner is re-probed.
 */

import type {
  RunnerSetupSource,
  RunnerSetupStarted,
  RunnerSetupStep,
} from "@argus/remote-protocol";
import os from "node:os";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { loginShellEnv } from "../terminal/loginEnv";
import {
  createHostTerminal,
  defaultShell,
  waitForTerminal,
} from "../terminal/multiplexer";
import { forgetRunnerAvailability, getRunnerById } from "./registry";
import { forgetRunnerAuth, telemetryRunner } from "./runnerAccounts";

/** What owns setup terminals in place of a session. */
export const RUNNER_SETUP_OWNER = "runner-setup";

const STEP_COMMAND = {
  install: "installCommand",
  login: "loginCommand",
  logout: "logoutCommand",
} as const;

const STEP_TITLE = {
  install: "Install",
  login: "Sign in to",
  logout: "Sign out of",
};
const STEP_NOUN = { install: "install", login: "sign-in", logout: "sign-out" };

export async function startRunnerSetup(
  runnerId: string,
  step: RunnerSetupStep,
  source: RunnerSetupSource = "picker",
): Promise<RunnerSetupStarted> {
  const runner = getRunnerById(runnerId);
  const setup = runner?.setup?.();
  if (!runner || !setup) {
    throw `${runner?.displayName ?? runnerId} can't be set up from Argus.`;
  }
  const command = setup[STEP_COMMAND[step]];
  if (!command) {
    if (step === "install" && setup.installUrl) {
      await hostPlatform().openExternal(setup.installUrl);
      capture(runnerId, step, source, "opened_page");

      return { terminalId: null, openedUrl: setup.installUrl };
    }
    throw `${runner.displayName} has no ${STEP_NOUN[step]} command.`;
  }

  const title = `${STEP_TITLE[step]} ${runner.displayName}`;
  const terminalId = createHostTerminal(RUNNER_SETUP_OWNER, command, title);
  finish(runnerId, step, source, terminalId).catch((e: unknown) =>
    warn(`[runnerSetup] ${runnerId} ${step}: ${String(e)}`),
  );

  return { terminalId, openedUrl: null };
}

async function finish(
  runnerId: string,
  step: RunnerSetupStep,
  source: RunnerSetupSource,
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
  forgetRunnerAuth(runnerId);
  capture(runnerId, step, source, exitCode === 0 ? "succeeded" : "failed");
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

const ACCOUNT_ACTION = {
  install: "install",
  login: "sign_in",
  logout: "sign_out",
} as const;

/** One event per action: the picker's own, or the Accounts page's. */
function capture(
  runnerId: string,
  step: RunnerSetupStep,
  source: RunnerSetupSource,
  outcome: "failed" | "opened_page" | "succeeded",
): void {
  const runner = telemetryRunner(runnerId);
  if (source === "accounts") {
    telemetryCapture("runner_account_action", {
      runner,
      action: ACCOUNT_ACTION[step],
      outcome,
    });
  } else if (step !== "logout") {
    telemetryCapture("runner_setup", { runner, step, outcome });
  }
}
