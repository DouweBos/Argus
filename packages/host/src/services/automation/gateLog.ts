/**
 * What the read-only gate turned away, kept so you can decide it was fine.
 *
 * The allowlist that holds a `propose` run to reading cannot know every
 * command your playbooks will reach for. Rather than make you guess what to
 * add, each refusal is recorded here with the allowlist entry that would have
 * let it through — the Settings screen lists them and promoting one is a
 * click. Widening is always your decision, never a run's.
 *
 * Entries collapse by that suggested entry: a playbook that tries `conductor
 * ui` every morning is one row with a count, not thirty.
 */

import crypto from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";
import { readEnvelope, writeJson } from "./jsonFile";
import { gateLogFilePath } from "./paths";

const SCHEMA_VERSION = 1;

/** Past this the oldest go; the list is a prompt to act, not an audit trail. */
const MAX_ENTRIES = 100;

/** One thing a read-only run was refused, and what would allow it. */
export interface GateLogEntry {
  id: string;
  automation_id: string;
  automation_name: string;
  run_id: string;
  /** `Bash` or the MCP tool name. */
  tool_name: string;
  /** The command, when it was a shell call. Null for a tool call. */
  command: string | null;
  /**
   * What to add to the allowlist to permit this. A command prefix for Bash
   * (`conductor screenshot`), otherwise the tool name.
   */
  suggested_entry: string;
  /** Which list `suggested_entry` belongs in. */
  kind: "command" | "tool";
  first_seen_at: number;
  last_seen_at: number;
  /** How many times this same refusal has happened. */
  count: number;
}

let cache: GateLogEntry[] | null = null;

function load(): GateLogEntry[] {
  cache ??= readEnvelope<GateLogEntry>(
    gateLogFilePath(),
    "automation gate log",
    "entries",
    SCHEMA_VERSION,
  );

  return cache;
}

function persist(entries: GateLogEntry[]): void {
  writeJson(gateLogFilePath(), { version: SCHEMA_VERSION, entries });
  emitHostEvent("automation_gate_log:changed", entries.length);
}

/** Test seam: drop the cache so the next read comes off disk again. */
export function resetGateLogCache(): void {
  cache = null;
}

/**
 * The allowlist entry that would permit `command`: its command word, plus a
 * subcommand when the tool takes one, so promoting `gh pr list` does not also
 * hand over `gh pr merge`.
 */
export function suggestedEntryFor(command: string): string {
  const words = command
    .trim()
    .split(/\s+/)
    .filter((w) => !w.startsWith("-"));
  const head = words[0] ?? "";
  const bare = head.includes("/")
    ? head.slice(head.lastIndexOf("/") + 1)
    : head;
  if (!bare) {
    return command.trim().slice(0, 40);
  }
  // A second bare word is a subcommand often enough to be the safer default.
  const second = words[1];

  return second && /^[a-z][\w-]*$/i.test(second) ? `${bare} ${second}` : bare;
}

export function recordGateRefusal(entry: {
  automationId: string;
  automationName: string;
  runId: string;
  toolName: string;
  command: string | null;
}): void {
  const kind = entry.command === null ? "tool" : "command";
  const suggested =
    entry.command === null ? entry.toolName : suggestedEntryFor(entry.command);

  const entries = load();
  const now = Date.now();
  const existing = entries.find(
    (e) => e.suggested_entry === suggested && e.kind === kind,
  );
  if (existing) {
    existing.count += 1;
    existing.last_seen_at = now;
    // Keep the most recent context; the old run is gone by the time you look.
    existing.automation_id = entry.automationId;
    existing.automation_name = entry.automationName;
    existing.run_id = entry.runId;
    existing.command = entry.command;
  } else {
    entries.push({
      id: crypto.randomUUID(),
      automation_id: entry.automationId,
      automation_name: entry.automationName,
      run_id: entry.runId,
      tool_name: entry.toolName,
      command: entry.command,
      suggested_entry: suggested,
      kind,
      first_seen_at: now,
      last_seen_at: now,
      count: 1,
    });
  }

  entries.sort((a, b) => b.last_seen_at - a.last_seen_at);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
  persist(entries);
}

/** Everything turned away and not yet dealt with, newest first. */
export function listGateLog(): GateLogEntry[] {
  return load().map((e) => ({ ...e }));
}

/** Drop one entry — you allowed it, or decided it should stay refused. */
export function dismissGateLogEntry(id: string): void {
  const entries = load().filter((e) => e.id !== id);
  cache = entries;
  persist(entries);
}

export function clearGateLog(): void {
  cache = [];
  persist([]);
}
