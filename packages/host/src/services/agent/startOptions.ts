/**
 * What a start composer offers before its agent exists: the slash commands and
 * models of the CLI the start will run. Answered from the session's warm spare,
 * else from the last CLI of that runner to finish its handshake — kept on disk,
 * so a fresh host offers models before its first agent has run.
 */

import type { AgentModelInfo, AgentSlashCommand } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";
import { sessionRunnerId } from "../session/models";
import { awaitSpare, getSpare } from "./spares";

export interface StartOptions {
  slashCommands: AgentSlashCommand[];
  models: AgentModelInfo[];
}

/** Long enough for a spare's handshake, short enough for a composer to open. */
const SPARE_WAIT_MS = 8_000;

let lastKnown: Map<string, StartOptions> | null = null;

function cachePath(): string {
  return path.join(argusHomeDir(), "start-options.json");
}

function known(): Map<string, StartOptions> {
  if (!lastKnown) {
    lastKnown = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as Record<
        string,
        unknown
      >;
      for (const [runnerId, caps] of Object.entries(raw)) {
        const options = fromCapabilities(caps);
        if (options) {
          lastKnown.set(runnerId, options);
        }
      }
    } catch {
      // Missing or unreadable: nothing is known until a handshake.
    }
  }

  return lastKnown;
}

function persist(cache: Map<string, StartOptions>): void {
  const out: Record<string, { commands: unknown; models: unknown }> = {};
  for (const [runnerId, o] of cache) {
    out[runnerId] = { commands: o.slashCommands, models: o.models };
  }
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(out), "utf8");
  } catch (e) {
    warn(`[start-options] saving the last-known list failed: ${String(e)}`);
  }
}

function fromCapabilities(caps: unknown): StartOptions | null {
  const c = caps as { commands?: unknown; models?: unknown } | null;
  if (!c || (!Array.isArray(c.commands) && !Array.isArray(c.models))) {
    return null;
  }

  return {
    slashCommands: Array.isArray(c.commands)
      ? (c.commands as AgentSlashCommand[])
      : [],
    models: Array.isArray(c.models) ? (c.models as AgentModelInfo[]) : [],
  };
}

/** Called with every handshake, so the cache follows the CLI's updates. */
export function rememberStartOptions(runnerId: string, caps: unknown): void {
  const options = fromCapabilities(caps);
  if (!options) {
    return;
  }
  const cache = known();
  const before = cache.get(runnerId);
  cache.set(runnerId, options);
  if (JSON.stringify(before) !== JSON.stringify(options)) {
    persist(cache);
  }
}

/** The models a runner's CLI last reported, for a start with no session to ask. */
export function lastKnownModels(runnerId: string): AgentModelInfo[] {
  return known().get(runnerId)?.models ?? [];
}

export async function getStartOptions(
  sessionId: string,
  runnerId?: string | null,
): Promise<StartOptions> {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }
  const runner = runnerId ?? sessionRunnerId(session);
  const cached = known().get(runner);
  // Nothing known yet: a spare on its way is worth the wait.
  const spare = cached
    ? getSpare(sessionId)
    : await awaitSpare(sessionId, SPARE_WAIT_MS);
  const fromSpare =
    spare?.agent.runner.id === runner
      ? fromCapabilities(spare.agent.handle.initializeResponse())
      : null;

  return fromSpare ?? cached ?? { slashCommands: [], models: [] };
}

/** Forget the in-memory cache; `onDisk` also drops the file. */
export function resetStartOptions(onDisk = true): void {
  lastKnown = null;
  if (onDisk) {
    fs.rmSync(cachePath(), { force: true });
  }
}
