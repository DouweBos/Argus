import type { ChangesetEntry } from "../lib/types";
import { useCallback, useState } from "react";
import {
  sendUserMessageToAgent,
  startAgentInSession,
} from "../lib/agentLifecycle";

interface UseValidateChangesetsArgs {
  baseBranch?: string | null;
  changesets: ChangesetEntry[];
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
  changesets: ChangesetEntry[],
): string {
  const list = changesets.length
    ? changesets
        .map(
          (c) =>
            `- \`.changeset/${c.filename}\` — ${c.summary.split("\n")[0] || "(no summary)"}`,
        )
        .join("\n")
    : "(none detected)";

  return `Review the pending changesets in \`.changeset/\` and tell me which ones should actually ship when this session merges into \`${baseBranch}\`.

Pending changesets on \`${sessionBranch}\`:
${list}

Why this matters: agents in earlier turns sometimes write a changeset describing a fix/feature that then gets reverted, refactored out, or never actually lands on this branch. Those stale changeset files otherwise ship release notes for work that isn't in the diff.

Steps:
1. Run \`git diff ${baseBranch}...HEAD --stat\` and \`git diff ${baseBranch}...HEAD -- .changeset/\` to see what this branch really changes.
2. For each changeset above, open it and verify the behavior it describes is actually present in the branch's non-\`.changeset/\` diff. If the described change isn't in the code (e.g. it was reverted, superseded, or the summary is wrong), the changeset is stale.
3. Delete stale changeset files outright (\`rm .changeset/<name>.md\`). Don't rewrite summaries to match — we want the record of release notes to reflect what we meant to ship.
4. If a changeset is mostly right but the summary has drifted from reality, fix the summary in place. Keep it short and present-tense.
5. Do not touch any files outside \`.changeset/\`. Do not commit — leave the changes staged so the user can review before merge.
6. Report: which changesets you kept as-is, which you edited (and why), and which you removed (and why).`;
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
      await sendUserMessageToAgent(info.agent_id, prompt, undefined, {
        assumeIdle: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setIsDispatching(false);
    }
  }, [sessionId, baseBranch, sessionBranch, changesets, isDispatching]);

  return { dispatch, error, isDispatching };
}
