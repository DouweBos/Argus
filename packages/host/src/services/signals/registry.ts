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
import { githubSource } from "./sources/github";

const SOURCES: SignalSource[] = [githubSource];

export function listSignalSources(): SignalSource[] {
  return [...SOURCES];
}

export function getSignalSource(id: string): SignalSource | null {
  return SOURCES.find((s) => s.id === id) ?? null;
}

export interface GatheredSignals {
  /** Everything native sources fetched, newest first. */
  items: WorkItem[];
  /** Prompt paragraphs contributed by agent-mode sources. */
  instructions: string[];
  /** Ids of sources that were configured but could not answer. */
  unavailable: string[];
}

export async function gatherSignals(opts: {
  sourceIds: string[];
  repoRoots: string[];
}): Promise<GatheredSignals> {
  const result: GatheredSignals = {
    items: [],
    instructions: [],
    unavailable: [],
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

  return result;
}

/** The work items a run's agent sees, as the prompt renders them. */
export function serializeWorkItems(items: WorkItem[]): string {
  if (items.length === 0) {
    return "(no work items — say so in the report rather than inventing any)";
  }

  return JSON.stringify(items, null, 2);
}
