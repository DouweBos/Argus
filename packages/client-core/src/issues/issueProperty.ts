/**
 * Linear's property menus and hover cards: the options with their number keys
 * and who last changed a property. The TS twin of ArgusCore's
 * `LinearIssueProperty`, sharing its test vectors.
 */

import type {
  LinearHistoryEvent,
  LinearWorkflowState,
} from "@argus/remote-protocol";
import { PRIORITY_NAMES } from "@argus/remote-protocol/linearLabels";
import { byWorkflow, PRIORITY_ORDER } from "./issueBoard";

export { shortDuration, timeInStatus } from "@argus/remote-protocol/issueTime";
export type { StatusStint } from "@argus/remote-protocol/issueTime";

/** One pickable value: a workflow state's id, or a priority's number. */
export interface IssuePropertyOption {
  id: string;
  title: string;
  /** The digit that picks it while the menu is open. */
  key: string | null;
}

export interface IssueStatusOption extends IssuePropertyOption {
  type: string;
  color: string | null;
}

/** 1…9, then 0, then nothing. */
function digitKey(index: number): string | null {
  if (index < 9) {
    return String(index + 1);
  }

  return index === 9 ? "0" : null;
}

/** The team's workflow in order, keyed 1…9 then 0, the rest unkeyed. */
export function statusOptions(
  states: readonly LinearWorkflowState[],
): IssueStatusOption[] {
  return [...states].sort(byWorkflow).map((state, index) => ({
    id: state.id,
    title: state.name,
    type: state.type,
    color: state.color ?? null,
    key: digitKey(index),
  }));
}

/** Urgent to Low, then No priority; each keyed by Linear's own number. */
export const PRIORITY_OPTIONS: IssuePropertyOption[] = PRIORITY_ORDER.map(
  (p) => ({ id: String(p), title: PRIORITY_NAMES[p], key: String(p) }),
);

/** The most recent change to that property; null when it hasn't moved since the issue was created. */
export function lastChange(
  history: readonly LinearHistoryEvent[] | null | undefined,
  kind: LinearHistoryEvent["kind"],
): LinearHistoryEvent | null {
  let latest: LinearHistoryEvent | null = null;
  for (const event of history ?? []) {
    if (
      event.kind === kind &&
      (!latest || event.createdAt > latest.createdAt)
    ) {
      latest = event;
    }
  }

  return latest;
}

/** The options whose title contains what's typed. */
export function visibleOptions<T extends IssuePropertyOption>(
  options: readonly T[],
  query: string,
): T[] {
  const term = query.trim().toLowerCase();

  return term
    ? options.filter((o) => o.title.toLowerCase().includes(term))
    : [...options];
}
