import type { DraftDesign } from "./useDesignDraft";
import type { LinearIssueContext } from "../../../lib/types";

/** What a composer is holding when the user steps away to look at a design. */
export interface ComposerStash {
  designs: DraftDesign[];
  issues: LinearIssueContext[];
  prompt: string;
}

const stashes = new Map<string, ComposerStash>();

export function stashComposer(sessionId: string, stash: ComposerStash): void {
  stashes.set(sessionId, stash);
}

/** Read without clearing, so a double-invoked initializer sees it both times. */
export function peekComposerStash(sessionId: string): ComposerStash | null {
  return stashes.get(sessionId) ?? null;
}

export function clearComposerStash(sessionId: string): void {
  stashes.delete(sessionId);
}
