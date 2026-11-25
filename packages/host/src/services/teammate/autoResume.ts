/**
 * Conversations the host went down in the middle of pick themselves back up
 * once it starts again. Each turn gets a few tries, counted on disk, so a
 * turn that crashes the host every time can't loop it forever.
 */

import { warn } from "@argus/host/logger";
import { interruptedFailure } from "./failure";
import { failThread, resumeThread } from "./recovery";
import { teammatesActive } from "./settings";
import { interruptedThreads, saveThreads } from "./threads";

/** Restarts one turn is picked back up through before it is left failed. */
export const MAX_AUTO_RESUMES = 2;
/** Between resumes, so several threads don't start their agents at once. */
const STAGGER_MS = 750;

export interface AutoResumeDeps {
  /** Waits for whatever an agent needs first (the MCP server). */
  ready: () => Promise<void>;
  resume: (threadId: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

let ran = false;

/** Test seam. */
export function resetAutoResume(): void {
  ran = false;
}

/** Once per boot: resume each interrupted thread, or mark it failed past the cap. */
export async function resumeInterruptedThreads(
  deps: AutoResumeDeps,
): Promise<{ resumed: number; failed: number }> {
  const summary = { resumed: 0, failed: 0 };
  if (ran || !teammatesActive()) {
    return summary;
  }
  ran = true;
  const interrupted = interruptedThreads();
  if (interrupted.length === 0) {
    return summary;
  }
  await deps.ready();
  for (const thread of interrupted) {
    if ((thread.auto_resumes ?? 0) >= MAX_AUTO_RESUMES) {
      failThread(thread.id, interruptedFailure(deps.now()));
      summary.failed++;
      continue;
    }
    // Counted before the agent starts: a crash during it still uses the try up.
    thread.auto_resumes = (thread.auto_resumes ?? 0) + 1;
    saveThreads();
    try {
      await deps.resume(thread.id);
      summary.resumed++;
    } catch (e) {
      warn(`[teammate] couldn't resume thread ${thread.id}: ${String(e)}`);
      failThread(thread.id, interruptedFailure(deps.now()));
      summary.failed++;
    }
    await deps.sleep(STAGGER_MS);
  }

  return summary;
}

export const defaultAutoResumeDeps: AutoResumeDeps = {
  ready: async () => {
    const { getMcpPort } = await import("../mcp/server");
    const deadline = Date.now() + 10_000;
    while (!getMcpPort() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
  },
  resume: (threadId) => resumeThread(threadId, "auto"),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};
