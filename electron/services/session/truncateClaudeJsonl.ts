/**
 * Pure truncation of a Claude Code JSONL transcript.
 *
 * The Claude Code CLI stores each session as a JSONL file under
 * `~/.claude/projects/<slug>/<uuid>.jsonl`. When we fork or restore a
 * conversation, we need to produce a new JSONL that:
 *   - ends at the Nth "real" user turn (inclusive)
 *   - keeps any pre-turn meta entries (summary, system init, etc.)
 *   - rewrites `sessionId` / `cwd` / `gitBranch` on every kept entry so the
 *     file stands alone as a resumable session
 *
 * Real user turns are identified by `type === "user"` where the first
 * content block is `type === "text"`. `tool_result` entries are also stored
 * with role=user but belong to the previous turn and must NOT trigger the
 * cutoff.
 *
 * Returns the list of rewritten lines, or `null` if nothing was kept.
 */
export function truncateClaudeJsonl(args: {
  destBranch: string;
  destCwd: string;
  forkTimestampMs: number;
  forkTurnNumber: number;
  newSessionId: string;
  raw: string;
}): string[] | null {
  const { destBranch, destCwd, forkTimestampMs, forkTurnNumber, newSessionId } =
    args;

  const lines = args.raw.split("\n");
  const kept: string[] = [];

  let userTurnsSeen = 0;
  let afterCutoff = false;
  const cutoffMs = forkTimestampMs;
  // Small buffer: frontend timestamps are set at event-receipt time and may
  // lead the JSONL timestamp by a few hundred ms. 2s is more than enough.
  const buffer = 2000;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = parsed.type;
    const isRealUser =
      type === "user" &&
      (() => {
        const message = parsed.message as { content?: unknown } | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as unknown[])
          : [];
        const first = content[0] as { type?: string } | undefined;

        return first?.type === "text";
      })();

    if (isRealUser) {
      userTurnsSeen += 1;
      if (userTurnsSeen > forkTurnNumber) {
        break;
      }
    }

    // Timestamp safety-net: once we've passed the cutoff and we're between
    // turns, stop. Keeps us from including events that trail the fork turn
    // when the turn counter alone can't tell.
    const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : null;
    if (ts) {
      const entryMs = Date.parse(ts);
      if (!Number.isNaN(entryMs) && entryMs > cutoffMs + buffer) {
        if (userTurnsSeen >= forkTurnNumber) {
          afterCutoff = true;
        }
      }
    }
    if (afterCutoff && isRealUser) {
      break;
    }

    // Rewrite identity fields so the new JSONL stands alone as a resumable
    // session tied to the forked worktree.
    if ("sessionId" in parsed) {
      parsed.sessionId = newSessionId;
    }
    if ("cwd" in parsed) {
      parsed.cwd = destCwd;
    }
    if ("gitBranch" in parsed) {
      parsed.gitBranch = destBranch;
    }

    kept.push(JSON.stringify(parsed));
  }

  if (kept.length === 0) {
    return null;
  }

  return kept;
}
