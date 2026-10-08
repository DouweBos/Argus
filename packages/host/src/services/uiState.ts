/**
 * Small persistent key/value blob store for UI state that belongs to one
 * Argus home and outlives a relaunch — and a switch between the Electron app
 * and Argus for Mac, which both read it: recent projects, per-session device
 * picks, git favourites. Stored as a single JSON file under
 * `~/.argus/ui-state.json`; use a real database for anything that needs
 * queries.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../lib/argusHome";
import { emitPrefsChanged } from "./prefsChanged";

function filePath(): string {
  return path.join(argusHomeDir(), "ui-state.json");
}

function readAll(): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
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
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function getUiState(key: string): string | null {
  const state = readAll();

  return state[key] ?? null;
}

export function setUiState(key: string, value: string): void {
  const state = readAll();
  state[key] = value;
  writeAll(state);
  emitPrefsChanged({ ui_state: [key] });
}
