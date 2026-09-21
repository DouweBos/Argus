/**
 * What the inbox is made of — shared with the home screen, so the two never
 * disagree about what counts as waiting on you.
 */

import type { AutomationRun, Proposal } from "../../lib/types";
import { useEffect, useState } from "react";
import { useAllRuns } from "../../stores/automationStore";
import {
  usePendingProposals,
  useStartedProposals,
} from "../../stores/proposalStore";

/** A run that failed days ago is history, not an inbox item. */
const FAILED_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_RUNS = 5;

export interface InboxItems {
  /** Recent failures — the automation itself needs a look. */
  failed: AutomationRun[];
  /** Decisions waiting on you. */
  pending: Proposal[];
  /** Work Argus already started, for information. */
  started: Proposal[];
}

export function useInboxItems(): InboxItems {
  const pending = usePendingProposals();
  const started = useStartedProposals();
  const runs = useAllRuns();
  // The cut-off below is relative to now, so it has to move while the screen
  // stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  const failed = runs
    .filter(
      (r) => r.status === "failed" && now - r.started_at < FAILED_RUN_WINDOW_MS,
    )
    .slice(0, MAX_FAILED_RUNS);

  return { failed, pending, started };
}

/** How many things are actually waiting on you — what a badge would show. */
export function inboxActionCount(items: InboxItems): number {
  return items.pending.length + items.failed.length;
}
