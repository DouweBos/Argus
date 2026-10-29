/**
 * What a start composer offers before its agent exists: the slash commands and
 * models of the CLI the start will run. Answered from the session's warm spare,
 * else from the last CLI of that runner to finish its handshake.
 */

import type { AgentModelInfo, AgentSlashCommand } from "@argus/remote-protocol";
import { appState } from "../../state";
import { sessionRunnerId } from "../session/models";
import { awaitSpare, getSpare } from "./spares";

export interface StartOptions {
  slashCommands: AgentSlashCommand[];
  models: AgentModelInfo[];
}

/** Long enough for a spare's handshake, short enough for a composer to open. */
const SPARE_WAIT_MS = 8_000;

const lastKnown = new Map<string, StartOptions>();

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
  if (options) {
    lastKnown.set(runnerId, options);
  }
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
  const cached = lastKnown.get(runner);
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

export function resetStartOptions(): void {
  lastKnown.clear();
}
