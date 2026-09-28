/**
 * Scratch pads — sessions for one-off agent work that belongs to no project.
 *
 * Like an automation host, a pad is a plain directory rather than a checkout:
 * no worktree, no setup pipeline, no git watchers. Unlike one, it is yours to
 * keep — it survives restarts until you delete it.
 */

import type { Session } from "../session/models";
import crypto from "node:crypto";
import fs from "node:fs";
import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { resolveRunnerForSession } from "../llm/resolve";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  loadScratchPads,
  removeScratchPadRecord,
  saveScratchPads,
  scratchPadDir,
  type ScratchPadRecord,
} from "./store";

const DEFAULT_NAME = "Scratch pad";

export interface CreateScratchPadOptions {
  name?: string | null;
  runner?: string | null;
  model?: string | null;
}

function toSession(pad: ScratchPadRecord): Session {
  return {
    id: pad.id,
    kind: "scratch_pad",
    branch: "",
    display_name: pad.display_name,
    description: "",
    path: pad.path,
    repo_root: pad.path,
    status: "ready",
    env_index: null,
    base_branch: null,
    runner_id: pad.runner_id,
    model: pad.model,
    claude_account_id: pad.claude_account_id ?? null,
  };
}

/** "Scratch pad 3" — the lowest number no live pad is using. */
function nextDefaultName(pads: ScratchPadRecord[]): string {
  const taken = new Set(pads.map((p) => p.display_name));
  let n = 1;
  while (taken.has(`${DEFAULT_NAME} ${n}`)) {
    n++;
  }

  return `${DEFAULT_NAME} ${n}`;
}

export function createScratchPad(
  options: CreateScratchPadOptions = {},
): Session {
  const pads = loadScratchPads();
  const id = crypto.randomUUID();
  const dir = scratchPadDir(id);
  fs.mkdirSync(dir, { recursive: true });

  // No `.argus.json` level: the pad is not a repo.
  const appDefault = loadAppSettings().default_llm ?? undefined;
  const { runner, defaultModel } = resolveRunnerForSession({
    repoRoot: dir,
    explicit: { runner: options.runner, model: options.model },
    appDefault,
  });

  const pad: ScratchPadRecord = {
    id,
    display_name: options.name?.trim() || nextDefaultName(pads),
    path: dir,
    created_at: Date.now(),
    runner_id: runner.id,
    model: defaultModel ?? appDefault?.model?.trim() ?? null,
  };
  saveScratchPads([...pads, pad]);

  const session = toSession(pad);
  appState.sessions.set(id, session);
  emitHostEvent("session:created", { ...session });
  telemetryCapture("scratch_pad_created", { has_name: Boolean(options.name) });
  info(`Created scratch pad ${id} at ${dir}`);

  return { ...session };
}

/** Load persisted pads into `appState` at startup. */
export function restoreScratchPads(): void {
  for (const pad of loadScratchPads()) {
    if (!appState.sessions.has(pad.id)) {
      fs.mkdirSync(pad.path, { recursive: true });
      appState.sessions.set(pad.id, toSession(pad));
    }
  }
}

export function listScratchPads(): Session[] {
  return [...appState.sessions.values()]
    .filter((s) => s.kind === "scratch_pad")
    .map((s) => ({ ...s }));
}

/** Forget the pad and remove its directory. Agents are the caller's job. */
export function disposeScratchPad(id: string): void {
  const removed = removeScratchPadRecord(id);
  if (!removed) {
    return;
  }
  fs.rm(removed.path, { recursive: true, force: true }, (e) => {
    if (e) {
      warn(`Failed to remove scratch pad dir ${removed.path}:`, e);
    }
  });
}
