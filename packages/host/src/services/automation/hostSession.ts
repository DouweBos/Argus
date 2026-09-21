/**
 * The neutral session an automation run's agent lives in.
 *
 * Unlike a worktree session this is not a git repo at all — just a directory
 * under `$ARGUS_HOME/automation-runs/`. No `git worktree add`, no setup
 * pipeline, no watchers: the agent reads the scope repos at their absolute
 * paths and orchestrates through MCP.
 */

import type { Session } from "../session/models";
import crypto from "node:crypto";
import fs from "node:fs";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { automationRunDir } from "./paths";

export function createAutomationHostSession(options: {
  automationId: string;
  runId: string;
  displayName: string;
}): Session {
  const dir = automationRunDir(options.automationId, options.runId);
  fs.mkdirSync(dir, { recursive: true });

  const session: Session = {
    id: crypto.randomUUID(),
    kind: "automation_host",
    branch: "",
    display_name: options.displayName,
    description: "",
    path: dir,
    repo_root: dir,
    status: "ready",
    env_index: null,
    base_branch: null,
  };

  appState.sessions.set(session.id, session);
  emitHostEvent("session:created", { ...session });
  info(`Created automation-host session ${session.id} at ${dir}`);

  return { ...session };
}

/** Drop the session once the run is over; the directory stays for the record. */
export function disposeAutomationHostSession(sessionId: string): void {
  if (!appState.sessions.delete(sessionId)) {
    return;
  }
  emitHostEvent("session:deleted", sessionId);
}
