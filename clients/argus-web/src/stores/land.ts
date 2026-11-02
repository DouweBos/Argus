/**
 * Landing a session's work: commit, push, merge into its base, and the base
 * itself. Mirrors the write side of `HostStore+Sessions`. Every write needs
 * `control`, which the gateway enforces; the computer still refuses a
 * protected base or a conflicting merge.
 *
 * The computer counts merges itself (`session_merged`), so only commits and
 * pushes are counted here.
 */

import {
  commitMessageText,
  hasCommitDescription,
  type CommitMessage,
  type LandMergeStrategy,
  NOT_CONNECTED_MESSAGE,
} from "@argus/client-core";
import { RemoteError, type Transport } from "@argus/remote-client";
import type { RemoteCommit } from "@argus/remote-protocol";
import type { ResultOf } from "../lib/protocol";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";
import { useGitStore } from "./git";
import { useProjectsStore } from "./projects";

export type CommitIdentity = ResultOf<"sessions.commit_identity">;
export type PushResult = ResultOf<"sessions.push">;

export interface CommitOptions {
  amend: boolean;
  signOff: boolean;
  sign: boolean;
}

function transport(): Transport {
  const t = currentTransport();
  if (!t) {
    throw new RemoteError("offline", NOT_CONNECTED_MESSAGE);
  }

  return t;
}

function refreshStatus(sessionId: string): void {
  void useGitStore.getState().loadGitStatus(sessionId);
}

/** Git's output. Options are only sent when set, so an older computer never sees them. */
export async function commitWork(
  sessionId: string,
  message: CommitMessage,
  options: CommitOptions,
): Promise<string> {
  const action = options.amend ? "amend" : "commit";
  try {
    const { output } = await request(transport(), "sessions.commit", {
      session_id: sessionId,
      message: commitMessageText(message),
      stage_all: true,
      ...(options.amend ? { amend: true } : {}),
      ...(options.signOff ? { sign_off: true } : {}),
      ...(options.sign ? { sign: true } : {}),
    });
    capture("web_work_landed", { action, success: true });
    capture("web_commit_composed", {
      has_description: hasCommitDescription(message),
      sign_off: options.signOff,
      signed: options.sign,
    });

    return output;
  } catch (err) {
    capture("web_work_landed", { action, success: false });
    throw err;
  } finally {
    refreshStatus(sessionId);
  }
}

export async function pushWork(sessionId: string): Promise<PushResult> {
  try {
    const result = await request(transport(), "sessions.push", {
      session_id: sessionId,
    });
    capture("web_work_landed", { action: "push", success: true });

    return result;
  } catch (err) {
    capture("web_work_landed", { action: "push", success: false });
    throw err;
  } finally {
    refreshStatus(sessionId);
  }
}

export async function mergeIntoBase(
  sessionId: string,
  strategy: LandMergeStrategy,
): Promise<void> {
  try {
    await request(transport(), "sessions.merge_base", {
      session_id: sessionId,
      strategy,
    });
  } finally {
    refreshStatus(sessionId);
  }
}

/** Why a merge would be refused; empty when it would go through, or unknown. */
export async function mergeBlockers(sessionId: string): Promise<string[]> {
  const t = currentTransport();
  if (!t) {
    return [];
  }
  try {
    const { blockers } = await request(t, "sessions.merge_blockers", {
      session_id: sessionId,
    });

    return blockers;
  } catch {
    return [];
  }
}

/** Null from a computer too old to say, or one with no identity at all. */
export async function commitIdentity(
  sessionId: string,
): Promise<CommitIdentity | null> {
  const t = currentTransport();
  if (!t) {
    return null;
  }

  return request(t, "sessions.commit_identity", {
    session_id: sessionId,
  }).catch(() => null);
}

/** The commit amend would rewrite, to start the fields from. */
export async function lastCommit(
  sessionId: string,
): Promise<RemoteCommit | null> {
  const t = currentTransport();
  if (!t) {
    return null;
  }
  try {
    const { commits } = await request(t, "sessions.branch_log", {
      session_id: sessionId,
      branch: "HEAD",
      count: 1,
    });

    return commits[0] ?? null;
  } catch {
    return null;
  }
}

/** Recent subjects, for the composer's `c:` and `fixup!` completions. */
export async function recentCommits(
  sessionId: string,
): Promise<RemoteCommit[]> {
  const t = currentTransport();
  if (!t) {
    return [];
  }

  return request(t, "sessions.branch_log", {
    session_id: sessionId,
    branch: "HEAD",
    count: 20,
  })
    .then((r) => r.commits)
    .catch(() => []);
}

export async function setBaseBranch(
  sessionId: string,
  repoRoot: string | null,
  baseBranch: string,
): Promise<void> {
  await request(transport(), "sessions.set_base_branch", {
    id: sessionId,
    base_branch: baseBranch,
  });
  capture("web_branch_acted", { action: "set_base" });
  if (repoRoot) {
    void useProjectsStore.getState().loadSessions(repoRoot);
  }
}
