import type { ReleaseNoteEntry } from "../lib/types";
import { useCallback, useState } from "react";
import {
  sendUserMessageToAgent,
  startAgentInSession,
} from "../lib/agentLifecycle";

interface UseValidateChangesetsArgs {
  baseBranch?: string | null;
  /** Subset of release-note entries with `format === "changesets"`. */
  changesets: ReleaseNoteEntry[];
  sessionBranch?: string | null;
  sessionId: string | null;
}

interface UseValidateChangesetsResult {
  dispatch: () => Promise<void>;
  error: string | null;
  isDispatching: boolean;
}

function buildValidationPrompt(
  baseBranch: string,
  sessionBranch: string,
  changesets: ReleaseNoteEntry[],
): string {
  const list = changesets.length
    ? changesets
        .map(
          (c) =>
            `- \`${c.filename}\` — ${c.content.split("\n")[0] || "(no summary)"}`,
        )
        .join("\n")
    : "(none detected)";

  return `Review the pending changesets in \`.changeset/\` and tell me which ones should actually ship when this session merges into \`${baseBranch}\`.

Pending changesets on \`${sessionBranch}\`:
${list}

Why this matters: the final changesets on a branch should describe the *net* change the branch introduces to \`${baseBranch}\` — nothing more. Agents in earlier turns often write changesets describing:
- work that was later reverted, refactored out, or never actually committed, or
- a fix to a bug that was itself introduced earlier *on this same branch* (so the bug never existed on \`${baseBranch}\` and users will never see it), or
- a UX improvement to a feature that is also being added in this same branch (the "improvement" is just a mid-branch iteration of a new feature — users will only see the final version).

All three are stale: they describe intra-branch churn, not net change. Users reading the release notes didn't have the bug and didn't see the earlier version of the feature, so release notes about fixing/improving them are noise.

Steps:
1. Run \`git diff ${baseBranch}...HEAD --stat\` and \`git log ${baseBranch}..HEAD --oneline\` to see what this branch really changes vs. \`${baseBranch}\`.
2. For each changeset above:
   a. Open it and verify the behavior it describes is actually present in the branch's non-\`.changeset/\` diff against \`${baseBranch}\`. If the code isn't there (reverted / superseded / wrong summary), it's stale.
   b. Check whether the changeset describes a fix for a bug or a UX tweak to a feature. If so, determine whether that bug or earlier feature state ever existed on \`${baseBranch}\`. Use \`git log ${baseBranch}..HEAD -- <relevant paths>\` and read the intermediate commits — if the bug was introduced *on this branch* and fixed later *on this branch*, or if the UX tweak adjusts a feature also being added by this branch, the changeset is stale. Users of \`${baseBranch}\` will only ever see the final state.
3. Delete stale changeset files outright (\`rm .changeset/<name>.md\`). Don't rewrite summaries to hide the churn — just remove them.
4. If a changeset describes a real net change but the summary has drifted from reality, fix the summary in place. Keep it short and present-tense.
5. If a real net change is missing a changeset entirely, that's fine — do not invent one. Only prune and correct what's already there.
6. Do not touch any files outside \`.changeset/\`. Do not commit — leave the changes staged so the user can review before merge.
7. Report: which changesets you kept as-is, which you edited (and why), and which you removed (and why — call out explicitly when the reason is "fixes a bug this branch introduced" or "iterates on a feature this branch adds").`;
}

/**
 * Dispatches a Claude Code agent into the session with a prompt asking it to
 * verify that each pending changeset actually describes work that landed on
 * this branch — agents often leave stale release notes behind for fixes that
 * were later reverted or never committed.
 */
export function useValidateChangesetsInChat({
  sessionId,
  baseBranch,
  sessionBranch,
  changesets,
}: UseValidateChangesetsArgs): UseValidateChangesetsResult {
  const [isDispatching, setIsDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(async () => {
    if (
      !sessionId ||
      !baseBranch ||
      !sessionBranch ||
      changesets.length === 0 ||
      isDispatching
    ) {
      return;
    }
    setIsDispatching(true);
    setError(null);
    try {
      const info = await startAgentInSession(sessionId, { focus: true });
      const prompt = buildValidationPrompt(
        baseBranch,
        sessionBranch,
        changesets,
      );
      await sendUserMessageToAgent(info.agent_id, prompt, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setIsDispatching(false);
    }
  }, [sessionId, baseBranch, sessionBranch, changesets, isDispatching]);

  return { dispatch, error, isDispatching };
}
