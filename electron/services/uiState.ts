/**
 * Small persistent key/value blob store for renderer UI state that needs to
 * survive relaunches (e.g. the last active route). Stored as a single JSON
 * file under `~/.argus/ui-state.json` — deliberately lightweight; use a real
 * database for anything that needs queries.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE = path.join(os.homedir(), ".argus", "ui-state.json");

function readAll(): Record<string, string> {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    // file doesn't exist yet / unreadable — start fresh
  }

  return {};
}

function writeAll(state: Record<string, string>): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function getUiState(key: string): string | null {
  const state = readAll();

  return state[key] ?? null;
}

export function setUiState(key: string, value: string): void {
  const state = readAll();
  state[key] = value;
  writeAll(state);
}
