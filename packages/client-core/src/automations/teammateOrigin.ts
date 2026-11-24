/**
 * Proposals a teammate conversation raises carry `teammate-chat:<teammateId>`
 * as their automation and `thread:<threadId>` as their run: they link to the
 * conversation, not to an automation run.
 */

const AUTOMATION_PREFIX = "teammate-chat:";
const RUN_PREFIX = "thread:";

export interface TeammateThreadRef {
  teammateId: string;
  /** Null when the run id doesn't name a thread: open the newest. */
  threadId: string | null;
}

export function teammateThreadOrigin(
  automationId: string,
  runId: string | null | undefined,
): TeammateThreadRef | null {
  if (!automationId.startsWith(AUTOMATION_PREFIX)) {
    return null;
  }
  const teammateId = automationId.slice(AUTOMATION_PREFIX.length);
  if (!teammateId) {
    return null;
  }
  const threadId = runId?.startsWith(RUN_PREFIX)
    ? runId.slice(RUN_PREFIX.length) || null
    : null;

  return { teammateId, threadId };
}
