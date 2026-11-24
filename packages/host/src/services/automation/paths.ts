/**
 * On-disk locations for automation state, all under `$ARGUS_HOME` so a
 * headless server (which uses `~/.argus-server`) never collides with a desktop
 * on the same machine.
 */

import type { MemoryOwner } from "./models";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

export function automationsFilePath(): string {
  return path.join(argusHomeDir(), "automations.json");
}

export function automationRunsFilePath(): string {
  return path.join(argusHomeDir(), "automation-runs.json");
}

/** Neutral working directory for one run's host agent. Not a git repo. */
export function automationRunDir(automationId: string, runId: string): string {
  return path.join(argusHomeDir(), "automation-runs", automationId, runId);
}

/** Every run directory belonging to one automation. */
export function automationRunsDir(automationId: string): string {
  return path.join(argusHomeDir(), "automation-runs", automationId);
}

/** Sessions automations started, so their claims survive a restart. */
export function automationSessionsFilePath(): string {
  return path.join(argusHomeDir(), "automation-sessions.json");
}

/** How the proposals turned out — the calibration loop's half of the record. */
export function outcomesFilePath(): string {
  return path.join(argusHomeDir(), "automation-outcomes.json");
}

/** What the read-only gate refused, pending your decision. */
export function gateLogFilePath(): string {
  return path.join(argusHomeDir(), "automation-gate-log.json");
}

/** Proposals emitted by runs, across every automation. */
export function proposalsFilePath(): string {
  return path.join(argusHomeDir(), "automation-proposals.json");
}

/** One automation's memory: `MEMORY.md` plus a file per memory. */
export function automationMemoryDir(automationId: string): string {
  return path.join(argusHomeDir(), "automation-memory", automationId);
}

/** One teammate's home: its soul, its memory and its conversation folder. */
export function teammateDir(teammateId: string): string {
  return path.join(argusHomeDir(), "teammates", teammateId);
}

export function memoryDirFor(owner: MemoryOwner): string {
  return owner.kind === "teammate"
    ? path.join(teammateDir(owner.id), "memory")
    : automationMemoryDir(owner.id);
}

/** What each signal trigger has already seen, so a restart doesn't refire. */
export function signalWatchFilePath(): string {
  return path.join(argusHomeDir(), "automation-signal-watch.json");
}

/** Events waiting for a run, per automation. */
export function automationEventQueueFilePath(): string {
  return path.join(argusHomeDir(), "automation-event-queue.json");
}

/** Webhook secrets, per automation. Owner-only. */
export function automationWebhooksFilePath(): string {
  return path.join(argusHomeDir(), "automation-webhooks.json");
}
