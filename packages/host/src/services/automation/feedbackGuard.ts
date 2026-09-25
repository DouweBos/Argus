/**
 * What a feedback turn may not do to the inbox.
 *
 * Feedback is an argument about a report, not a mandate to empty the inbox:
 * a run picked back up to answer one is allowed to add proposals and rewrite
 * its report, and nothing else. Withdrawing and superseding are refused for
 * the length of the turn unless the user ticked the box that allows them.
 *
 * In memory on purpose — a turn does not outlive the host process that is
 * running it, so there is nothing to persist.
 */

const openTurns = new Map<string, { allowClearing: boolean }>();

export function beginFeedbackTurn(runId: string, allowClearing: boolean): void {
  openTurns.set(runId, { allowClearing });
}

export function endFeedbackTurn(runId: string): void {
  openTurns.delete(runId);
}

/**
 * Why this run may not clear a proposal right now, or null when it may. The
 * string is handed straight to the model as a tool error.
 */
export function proposalClearingBlock(runId: string): string | null {
  const turn = openTurns.get(runId);
  if (!turn || turn.allowClearing) {
    return null;
  }

  return "Refused: you are answering feedback on a report you already wrote. Feedback only ever adds to the inbox — the user did not allow this turn to withdraw or supersede anything. Emit the proposal on its own and say in the report what you think should replace.";
}

/** Test seam. */
export function resetFeedbackTurns(): void {
  openTurns.clear();
}
