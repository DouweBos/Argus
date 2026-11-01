/**
 * Pinned chats, persisted at `$ARGUS_HOME/pinned-chats.json`. A pin carries
 * everything a resume needs, so it works with chat history turned off.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../../lib/argusHome";

const SCHEMA_VERSION = 1;
const FILENAME = "pinned-chats.json";

export interface PinnedChat {
  /** The id it comes back under, so routes and open tabs keep working. */
  agentId: string;
  sessionId: string;
  repoRoot: string;
  /** Runner conversation to `--resume`; absent until its first turn. */
  runnerSessionId?: string;
  runnerId?: string;
  model?: string;
  permissionMode?: string;
  effort?: string;
  title?: string;
  pinnedAt: number;
}

interface PinFile {
  version: number;
  pins: PinnedChat[];
}

let cache: Map<string, PinnedChat> | null = null;

function filePath(): string {
  return path.join(argusHomeDir(), FILENAME);
}

function load(): Map<string, PinnedChat> {
  if (cache) {
    return cache;
  }
  cache = new Map();
  try {
    const file = JSON.parse(fs.readFileSync(filePath(), "utf8")) as PinFile;
    if (file.version === SCHEMA_VERSION) {
      for (const pin of file.pins ?? []) {
        if (pin?.agentId && pin.sessionId && pin.repoRoot) {
          cache.set(pin.agentId, pin);
        }
      }
    }
  } catch {
    // Missing or unreadable: nothing pinned.
  }

  return cache;
}

function save(pins: Map<string, PinnedChat>): void {
  const file: PinFile = { version: SCHEMA_VERSION, pins: [...pins.values()] };
  const target = filePath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch (e) {
    warn("Failed to write pinned chats:", e);
  }
}

export function listPins(): PinnedChat[] {
  return [...load().values()].sort((a, b) => a.pinnedAt - b.pinnedAt);
}

export function getPin(agentId: string): PinnedChat | undefined {
  return load().get(agentId);
}

export function isPinned(agentId: string): boolean {
  return load().has(agentId);
}

export function pinForRunnerSession(
  runnerSessionId: string,
): PinnedChat | undefined {
  return [...load().values()].find(
    (p) => p.runnerSessionId === runnerSessionId,
  );
}

export function putPin(pin: PinnedChat): void {
  const pins = load();
  pins.set(pin.agentId, pin);
  save(pins);
}

/** Merge fresh settings into a pin; writes only when something changed. */
export function updatePin(
  agentId: string,
  patch: Partial<Omit<PinnedChat, "agentId" | "pinnedAt">>,
): void {
  const pins = load();
  const current = pins.get(agentId);
  if (!current) {
    return;
  }
  const next: PinnedChat = { ...current };
  let changed = false;
  for (const [key, value] of Object.entries(patch) as [
    keyof typeof patch,
    string | undefined,
  ][]) {
    if (value !== undefined && next[key] !== value) {
      (next as unknown as Record<string, unknown>)[key] = value;
      changed = true;
    }
  }
  if (changed) {
    pins.set(agentId, next);
    save(pins);
  }
}

export function removePin(agentId: string): boolean {
  const pins = load();
  if (!pins.delete(agentId)) {
    return false;
  }
  save(pins);

  return true;
}

/** Move a pin to the agent that took its conversation over. */
export function movePin(fromAgentId: string, toAgentId: string): void {
  const pins = load();
  const pin = pins.get(fromAgentId);
  if (!pin || fromAgentId === toAgentId) {
    return;
  }
  pins.delete(fromAgentId);
  pins.set(toAgentId, { ...pin, agentId: toAgentId });
  save(pins);
}

/** Test-only: forget the in-memory copy so the next read hits disk. */
export function resetPinCache(): void {
  cache = null;
}
