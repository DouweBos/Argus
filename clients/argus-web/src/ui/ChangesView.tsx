/**
 * Read-only changes review for a session — git status summary plus the diff of
 * what the agent changed, rendered with Peacock's diff primitives. A toggle
 * switches between the branch diff (everything vs the base branch) and the
 * working diff (uncommitted vs HEAD). Monitor-scoped; no staging/commit.
 */

import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  FileDiffCard,
  Icons,
  parseDiff,
  SegmentedControl,
  Spinner,
  StatusDot,
} from "@argus/peacock";
import { useAppStore } from "../lib/store";

type Mode = "branch" | "working";

const MODE_OPTIONS = [
  { value: "branch" as const, label: "Vs base branch" },
  { value: "working" as const, label: "Uncommitted" },
];

export function ChangesView({ sessionId }: { sessionId: string }) {
  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.gitStatusBySession[sessionId]);
  const loadGitStatus = useAppStore((s) => s.loadGitStatus);
  const loadDiff = useAppStore((s) => s.loadDiff);
  const [mode, setMode] = useState<Mode>("branch");
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    loadGitStatus(sessionId).catch(() => {});
    loadDiff(sessionId, mode)
      .then((r) => setDiff(r.diff))
      .catch(() => setDiff(""))
      .finally(() => setLoading(false));
  }, [sessionId, mode, loadGitStatus, loadDiff]);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    setLoading(true);
    refresh();
    const poll = setInterval(refresh, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connection, refresh]);

  const files = diff ? parseDiff(diff) : [];

  return (
    <div className="aw-changes">
      <div className="aw-changes-bar">
        <SegmentedControl<Mode>
          aria-label="Diff mode"
          value={mode}
          options={MODE_OPTIONS}
          onChange={setMode}
        />
      </div>

      {status && (
        <div className="aw-changes-status">
          <StatusDot
            tone={status.conflict_count > 0 ? "warning" : "accent"}
            label={status.branch}
          />
          <span className="aw-muted">
            {status.ahead > 0 && `↑${status.ahead} `}
            {status.behind > 0 && `↓${status.behind} `}
            {status.dirty_count > 0
              ? `${status.dirty_count} changed`
              : "clean"}
            {status.conflict_count > 0 &&
              ` · ${status.conflict_count} conflicts`}
          </span>
        </div>
      )}

      {loading && diff === null ? (
        <div className="aw-center">
          <Spinner />
          <span className="aw-muted">Loading changes…</span>
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={<Icons.BranchIcon size={22} />}
          title="No changes"
          body={
            mode === "branch"
              ? "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
              : "No uncommitted changes in the working tree."
          }
        />
      ) : (
        <div className="aw-changes-files">
          {files.map((f) => (
            <FileDiffCard key={f.newPath || f.oldPath} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}
