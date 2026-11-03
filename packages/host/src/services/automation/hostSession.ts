/**
 * The neutral session an automation run's agent lives in.
 *
 * Unlike a worktree session this is not a git repo at all — just a directory
 * under `$ARGUS_HOME/automation-runs/`. No `git worktree add`, no setup
 * pipeline, no watchers: the agent reads the scope repos at their absolute
 * paths and orchestrates through MCP.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { listClaudeAccounts } from "../claudeAuth/accounts";
import { resolveRunnerForSession } from "../llm/resolve";
import { DEFAULT_RUNNER_ID, type Session } from "../session/models";
import { automationRunDir } from "./paths";

interface HostSessionOptions {
  automationId: string;
  runId: string;
  displayName: string;
  /** Runner the automation pinned; null follows the app default. */
  runner?: string | null;
  model?: string | null;
  /** Claude account the automation pinned; null follows the active one. */
  claudeAccountId?: string | null;
}

/** The pin applies only on the default runner, and only while the account exists. */
function pinnedAccount(
  runnerId: string,
  accountId?: string | null,
): string | null {
  return runnerId === DEFAULT_RUNNER_ID &&
    accountId &&
    listClaudeAccounts().some((a) => a.id === accountId)
    ? accountId
    : null;
}

function hostSession(id: string, options: HostSessionOptions): Session {
  const dir = automationRunDir(options.automationId, options.runId);

  // No `.argus.json` level: the run dir is not a repo, so the cascade is the
  // automation's own pick, then the app default.
  const appDefault = loadAppSettings().default_llm ?? undefined;
  const { runner, defaultModel } = resolveRunnerForSession({
    repoRoot: dir,
    explicit: { runner: options.runner, model: options.model },
    appDefault,
  });

  return {
    id,
    kind: "automation_host",
    branch: "",
    display_name: options.displayName,
    description: "",
    path: dir,
    repo_root: dir,
    status: "ready",
    env_index: null,
    base_branch: null,
    runner_id: runner.id,
    model: defaultModel ?? appDefault?.model?.trim() ?? null,
    claude_account_id: pinnedAccount(runner.id, options.claudeAccountId),
  };
}

export function createAutomationHostSession(
  options: HostSessionOptions,
): Session {
  fs.mkdirSync(automationRunDir(options.automationId, options.runId), {
    recursive: true,
  });
  const session = hostSession(crypto.randomUUID(), options);

  appState.sessions.set(session.id, session);
  emitHostEvent("session:created", { ...session });
  info(`Created automation-host session ${session.id} at ${session.path}`);

  return { ...session };
}

/**
 * Bring a past run's session back after a restart, under the id the run
 * recorded, so its transcript can still be opened. Skipped once the run's
 * directory is gone.
 */
export function restoreAutomationHostSession(
  id: string,
  options: HostSessionOptions,
): void {
  if (
    appState.sessions.has(id) ||
    !fs.existsSync(automationRunDir(options.automationId, options.runId))
  ) {
    return;
  }
  appState.sessions.set(id, hostSession(id, options));
}

/** Drop the session once the run is over; the directory stays for the record. */
export function disposeAutomationHostSession(sessionId: string): void {
  if (!appState.sessions.delete(sessionId)) {
    return;
  }
  emitHostEvent("session:deleted", sessionId);
}
