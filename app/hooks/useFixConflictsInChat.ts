import { useCallback, useState } from "react";
import {
  sendUserMessageToAgent,
  startAgentInSession,
} from "../lib/agentLifecycle";

interface UseFixConflictsArgs {
  baseBranch?: string | null;
  conflicts: string[];
  sessionBranch?: string | null;
  sessionId: string | null;
}

interface UseFixConflictsResult {
  dispatch: () => Promise<void>;
  error: string | null;
  isDispatching: boolean;
}

function buildConflictResolutionPrompt(
  baseBranch: string,
  sessionBranch: string,
  conflictFiles: string[],
): string {
  const fileList = conflictFiles.length
    ? conflictFiles.map((f) => `- ${f}`).join("\n")
    : "(specific files could not be determined — git merge will report them)";

  return `Resolve merge conflicts between this session's branch (\`${sessionBranch}\`) and its base branch (\`${baseBranch}\`).

Expected conflicting files:
${fileList}

Steps:
1. Run \`git fetch\` then \`git merge ${baseBranch}\` in this session.
2. For each conflicting file, read both sides and resolve the conflict so both intents are preserved. Prefer the behavior this branch intended; don't silently drop changes from either side.
3. After resolving, run the project's type-check / build / tests to confirm nothing is broken.
4. Stage the resolved files and commit the merge with a clear message (e.g. \`Merge ${baseBranch} into ${sessionBranch}\`).
5. Report which files you resolved and any decisions you had to make.

Don't push. Don't merge back into \`${baseBranch}\` — the user will do that separately once you're done.`;
}

/**
 * Dispatches a Claude Code agent into the session with a prompt describing
 * the current merge conflicts. Shared between the changes panel and the
 * session-home merge card so both entry points behave identically.
 */
export function useFixConflictsInChat({
  sessionId,
  baseBranch,
  sessionBranch,
  conflicts,
}: UseFixConflictsArgs): UseFixConflictsResult {
  const [isDispatching, setIsDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(async () => {
    if (!sessionId || !baseBranch || !sessionBranch || isDispatching) {
      return;
    }
    setIsDispatching(true);
    setError(null);
    try {
      const info = await startAgentInSession(sessionId, { focus: true });
      const prompt = buildConflictResolutionPrompt(
        baseBranch,
        sessionBranch,
        conflicts,
      );
      await sendUserMessageToAgent(info.agent_id, prompt, undefined, {
        assumeIdle: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setIsDispatching(false);
    }
  }, [sessionId, baseBranch, sessionBranch, conflicts, isDispatching]);

  return { dispatch, error, isDispatching };
}
