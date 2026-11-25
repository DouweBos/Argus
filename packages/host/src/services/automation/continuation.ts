/**
 * "Continue the previous run's conversation": a run picks up where the last
 * one left off instead of starting from nothing.
 *
 * Every run keeps its own directory, so the previous run's transcript is
 * forked into this run's — its record and transcript stay intact, and
 * deleting an old run never breaks a newer one.
 */

import type { Automation, RunConversation } from "./models";
import type { Session } from "../session/models";
import { info } from "@argus/host/logger";
import { getRunnerById } from "../llm/registry";
import { sessionRunnerId } from "../session/models";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { listAutomationRuns } from "./manager";
import { automationRunDir } from "./paths";

export interface Continuation {
  /** What the run's agent resumes; undefined starts it fresh. */
  resumeRef: string | undefined;
  /** Null when there was nothing to continue: the option is off, or this is the first run. */
  conversation: RunConversation | null;
}

const FRESH: Continuation = { resumeRef: undefined, conversation: null };

/** Fork the previous run's conversation into this run's session, when there is one to fork. */
export async function continuationFor(
  automation: Automation,
  runId: string,
  session: Session,
): Promise<Continuation> {
  if (!automation.continue_conversation) {
    return FRESH;
  }
  // Newest first; a skipped run never had an agent, so it has nothing to give.
  const previous = listAutomationRuns(automation.id).find(
    (r) => r.id !== runId && r.host_session_id !== null,
  );
  if (!previous || !session.path) {
    return FRESH;
  }

  const resumeRef = await forkPrevious(
    automationRunDir(automation.id, previous.id),
    session,
  );
  const conversation: RunConversation = resumeRef ? "continued" : "fell_back";
  telemetryCapture("automation_conversation_continued", {
    outcome: conversation,
  });
  if (!resumeRef) {
    info(
      `automation ${automation.id}: run ${previous.id}'s conversation is gone, starting fresh`,
    );
  }

  return { resumeRef, conversation };
}

async function forkPrevious(
  sourceCwd: string,
  session: Session,
): Promise<string | undefined> {
  const runner = getRunnerById(sessionRunnerId(session));
  if (!runner?.latestTranscriptRef || !runner.forkTranscript) {
    return undefined;
  }
  try {
    const sourceRef = await runner.latestTranscriptRef(sourceCwd);
    if (!sourceRef) {
      return undefined;
    }
    const { resumeRef } = await runner.forkTranscript({
      sourceRef,
      sourceCwd,
      destCwd: session.path,
      destBranch: "",
      cutoffTimestampMs: Date.now(),
      keepTurnNumber: Number.MAX_SAFE_INTEGER,
    });

    return resumeRef ?? undefined;
  } catch (e) {
    info(`automation: forking the previous conversation failed: ${String(e)}`);

    return undefined;
  }
}

/** Said ahead of the playbook, so the agent reads the history as the last run's. */
export const CONTINUED_PREAMBLE =
  "This is a new run of the same automation. The conversation above is the previous run's; use what you learned there, but work from the signals and state below, which are current.";
