/**
 * A conversation's turns as they start and end: a turn that stops short
 * keeps why on its thread, and Resume picks the conversation back up.
 */

import type { OpenedThread } from "./threads";
import { CONTINUE_MESSAGE } from "../agent/limitResume";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  crashFailure,
  resultFailure,
  type TeammateThreadFailure,
} from "./failure";
import { onThreadTurn, type ThreadTurnEvent } from "./threadSessions";
import { openThread, saveThreads, threadRecord } from "./threads";

export type ResumeSource = "app" | "auto" | "slack";

let stopping = false;

/** The host is going down: its agents' exits are not crashes. */
export function stopThreadRecovery(): void {
  stopping = true;
}

/** Test seam. */
export function resetThreadRecovery(): void {
  stopping = false;
}

export function failThread(
  threadId: string,
  failure: TeammateThreadFailure,
): void {
  const thread = threadRecord(threadId);
  if (!thread) {
    return;
  }
  thread.failure = failure;
  thread.inflight_since = null;
  thread.auto_resumes = 0;
  saveThreads();
  telemetryCapture("teammate_thread_failed", { kind: failure.kind });
}

export function handleThreadTurn(
  threadId: string,
  event: ThreadTurnEvent,
  now: number = Date.now(),
): void {
  const thread = threadRecord(threadId);
  if (!thread) {
    return;
  }
  switch (event.kind) {
    case "started":
      thread.inflight_since ??= now;
      thread.failure = null;
      saveThreads();

      return;
    case "result":
      if (event.failed) {
        failThread(threadId, resultFailure(event.text, event.resetsAt, now));

        return;
      }
      if (thread.inflight_since || thread.failure || thread.auto_resumes) {
        thread.inflight_since = null;
        thread.failure = null;
        thread.auto_resumes = 0;
        saveThreads();
      }

      return;
    case "exit":
      if (stopping || !thread.inflight_since) {
        return;
      }
      if (event.intentional) {
        thread.inflight_since = null;
        thread.auto_resumes = 0;
        saveThreads();

        return;
      }
      failThread(threadId, crashFailure(event.code, now));
  }
}

onThreadTurn((threadId, event) => handleThreadTurn(threadId, event));

/** Pick a conversation back up where its last turn stopped. */
export async function resumeThread(
  threadId: string,
  source: ResumeSource,
  author?: string,
): Promise<OpenedThread> {
  const thread = threadRecord(threadId);
  if (!thread) {
    throw `Thread not found: ${threadId}`;
  }
  const kind = thread.failure?.kind ?? null;
  const opened = await openThread(thread.teammate_id, { threadId });
  // Cleared now: a queued continue only counts as started once it is sent.
  thread.failure = null;
  saveThreads();
  const { submitAgentMessage } = await import("../agent/conversation/actions");
  await submitAgentMessage(opened.agent_id, {
    text: CONTINUE_MESSAGE,
    author,
  });
  telemetryCapture("teammate_thread_resumed", { source, kind });

  return opened;
}
