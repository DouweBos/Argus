/**
 * The source table, and the one call a run makes against it.
 *
 * `gatherSignals` returns both halves of what a run needs: work items Node
 * already fetched, and instructions for the sources the agent fetches itself.
 * A source that throws or is unavailable contributes nothing and is named in
 * `unavailable` — a signal layer that can fail a run defeats the purpose.
 */

import type { SignalSource, WorkItem } from "./types";
import { warn } from "@argus/host/logger";
import {
  fenceUntrusted,
  redactFlagged,
  scanForInjection,
} from "./injectionScan";
import { githubSource } from "./sources/github";
import { githubPrsSource } from "./sources/githubPrs";
import { linearSource } from "./sources/linear";

const SOURCES: SignalSource[] = [githubSource, githubPrsSource, linearSource];

export function listSignalSources(): SignalSource[] {
  return [...SOURCES];
}

export function getSignalSource(id: string): SignalSource | null {
  return SOURCES.find((s) => s.id === id) ?? null;
}

/** One source as the automation editor shows it. */
export interface SignalSourceInfo {
  id: string;
  label: string;
  mode: SignalSource["mode"];
  /** False when the source has nothing to answer with — no `gh`, no MCP. */
  available: boolean;
}

/**
 * Every source with its availability resolved, so the editor can say *why* a
 * source is greyed out instead of letting a run discover it at 07:30.
 */
export async function describeSignalSources(): Promise<SignalSourceInfo[]> {
  return Promise.all(
    SOURCES.map(async ({ id, label, mode, isAvailable }) => ({
      id,
      label,
      mode,
      available: await isAvailable().catch(() => false),
    })),
  );
}

export interface GatheredSignals {
  /** Everything native sources fetched, newest first. */
  items: WorkItem[];
  /** Prompt paragraphs contributed by agent-mode sources. */
  instructions: string[];
  /** Ids of sources that were configured but could not answer. */
  unavailable: string[];
  /** Items whose text was withheld as an attempted injection. */
  withheld: { external_id: string; reason: string }[];
}

export async function gatherSignals(opts: {
  sourceIds: string[];
  repoRoots: string[];
}): Promise<GatheredSignals> {
  const result: GatheredSignals = {
    items: [],
    instructions: [],
    unavailable: [],
    withheld: [],
  };

  for (const id of opts.sourceIds) {
    const source = getSignalSource(id);
    if (!source) {
      result.unavailable.push(id);
      continue;
    }

    try {
      if (!(await source.isAvailable())) {
        result.unavailable.push(id);
        continue;
      }
      if (source.mode === "agent") {
        const text = source.agentInstructions?.();
        if (text) {
          result.instructions.push(text);
        }
        continue;
      }
      const items =
        (await source.fetchAssigned?.({ repoRoots: opts.repoRoots })) ?? [];
      result.items.push(...items);
    } catch (e) {
      warn(`signal source ${id} failed: ${String(e)}`);
      result.unavailable.push(id);
    }
  }

  result.items.sort((a, b) => b.updated_at - a.updated_at);

  // Everything above came from outside. Screen it before a run reads it.
  const findings = await scanForInjection(result.items);
  result.items = redactFlagged(result.items, findings);
  result.withheld = findings.map((f) => ({
    external_id: f.external_id,
    reason: f.reason,
  }));

  return result;
}

/** The work items a run's agent sees, as the prompt renders them. */
export function serializeWorkItems(
  items: WorkItem[],
  { agentSources = false }: { agentSources?: boolean } = {},
): string {
  if (items.length === 0) {
    return agentSources
      ? "(nothing was fetched natively — everything comes from the sources below)"
      : "(no work items — say so in the report rather than inventing any)";
  }

  // Fenced, always: this is data a stranger wrote, not instructions.
  return fenceUntrusted(JSON.stringify(items, null, 2));
}
