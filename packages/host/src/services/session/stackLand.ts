/**
 * Land a stack bottom-up: merge the bottom session (its pull request when it
 * has one, else locally into its base), move its children down onto that
 * base, and carry on with them. Stops at the first thing that needs a human.
 */

import type { MergeStrategy } from "./merge";
import type { Session } from "./models";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { mergeBranchPullRequest } from "../codeHost/pullRequests";
import { sessionPullRequestMayHaveChanged } from "../github/sessionPullRequests";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { git } from "./git";
import { mergeSessionIntoBase } from "./sessionOps";
import {
  openPullRequest,
  rebaseChildOnto,
  remoteName,
  saveStackLink,
  stackChildren,
  stackDescendants,
  stackRoot,
  syncPullRequest,
} from "./stack";

export interface LandStackResult {
  landed: string[];
  /** Where it stopped; null when the whole stack landed. */
  stopped: {
    /** Set when a child conflicted moving onto the base; paused for the resolver. */
    files: string[] | null;
    reason: string;
    session_id: string;
  } | null;
}

const MERGE_RETRIES = 3;
const MERGE_RETRY_MS = 5000;

/** The host recomputes mergeability for a few seconds after a push or a retarget. */
async function mergePullRequest(
  session: Session,
  number: number,
  strategy: MergeStrategy,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mergeBranchPullRequest({
        repoRoot: session.repo_root,
        head: session.branch,
        number,
        strategy: strategy === "squash" ? "squash" : "merge",
      });

      return;
    } catch (e) {
      const msg = String(e);
      const transient = /not mergeable|base branch was modified/i.test(msg);
      if (!transient || attempt >= MERGE_RETRIES) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, MERGE_RETRY_MS));
    }
  }
}

/** Land one session; returns the ref its children should move onto. */
async function landOne(
  session: Session,
  strategy: MergeStrategy,
): Promise<string> {
  const base = session.base_branch;
  if (!base) {
    throw "No base branch set for this session";
  }
  const pr = openPullRequest(session.id);
  if (!pr) {
    await mergeSessionIntoBase(session.id, strategy);

    return base;
  }
  await syncPullRequest(session);
  await mergePullRequest(session, pr.number, strategy);
  sessionPullRequestMayHaveChanged(session.id);
  emitHostEvent("session:merged", {
    sessionId: session.id,
    branch: session.branch,
    baseBranch: base,
  });
  const remote = await remoteName(session.repo_root);
  await git(session.repo_root, ["fetch", remote, base]);

  return `${remote}/${base}`;
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }

  return String(e);
}

export async function landStack(
  id: string,
  strategy: MergeStrategy,
): Promise<LandStackResult> {
  const root = stackRoot(id);
  const order = [root, ...stackDescendants(root.id)];
  const result: LandStackResult = { landed: [], stopped: null };
  const finish = (): LandStackResult => {
    telemetryCapture("session_stack_acted", {
      action: "land",
      success: result.stopped === null,
      conflict: Boolean(result.stopped?.files),
      size: order.length,
    });

    return result;
  };

  for (const entry of order) {
    const session = appState.sessions.get(entry.id);
    if (!session) {
      continue;
    }
    let landedOnto: string;
    try {
      landedOnto = await landOne(session, strategy);
    } catch (e) {
      result.stopped = {
        session_id: session.id,
        reason: errorText(e),
        files: null,
      };

      return finish();
    }
    result.landed.push(session.id);

    for (const child of stackChildren(session.id)) {
      saveStackLink(child, {
        base_branch: session.base_branch ?? null,
        parent_session_id: session.parent_session_id ?? null,
      });
      try {
        const { conflict } = await rebaseChildOnto(
          child,
          landedOnto,
          session.branch,
        );
        if (conflict) {
          result.stopped = {
            session_id: child.id,
            reason: "Moving it onto the landed base hit a conflict",
            files: conflict,
          };

          return finish();
        }
      } catch (e) {
        result.stopped = {
          session_id: child.id,
          reason: errorText(e),
          files: null,
        };

        return finish();
      }
    }
  }

  return finish();
}
