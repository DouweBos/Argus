/** `/sessions/:id/git/history?commit=`: one commit's diff, file by file. */

import type { RemoteCommit } from "@argus/remote-protocol";
import { useEffect, useMemo, useState } from "react";
import { describeError, relativeTime } from "@argus/client-core";
import {
  Card,
  EmptyState,
  FileDiffCard,
  Icons,
  parseDiff,
  Spinner,
} from "@argus/peacock";
import { branchLog, commitDiff } from "../../stores/branches";
import { useConnectionStore } from "../../stores/connection";

export function CommitScreen({
  hash,
  sessionId,
}: {
  hash: string;
  sessionId: string;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commit, setCommit] = useState<RemoteCommit | null>(null);
  const files = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    branchLog(sessionId, hash, 1)
      .then((list) => !cancelled && setCommit(list[0] ?? null))
      .catch(() => {});
    commitDiff(sessionId, hash)
      .then((d) => !cancelled && setDiff(d))
      .catch((err: unknown) => !cancelled && setError(describeError(err)));

    return () => {
      cancelled = true;
    };
  }, [ready, sessionId, hash]);

  if (error && diff === null) {
    return (
      <EmptyState
        icon={<Icons.WarningIcon size={22} />}
        title="Couldn't read the commit"
        body={error}
      />
    );
  }
  if (diff === null) {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Reading the commit…</span>
      </div>
    );
  }

  return (
    <div className="aw-ship">
      <Card stack>
        {commit && <span className="aw-ship-subject">{commit.subject}</span>}
        {commit?.body && <span className="aw-ship-body">{commit.body}</span>}
        <span className="aw-ship-mono aw-muted">
          {hash.slice(0, 12)}
          {commit && ` · ${commit.author} · ${relativeTime(commit.date)}`}
        </span>
      </Card>
      {files.length === 0 ? (
        <span className="aw-muted">No file changes.</span>
      ) : (
        files.map((f) => (
          <FileDiffCard key={f.newPath || f.oldPath} file={f} />
        ))
      )}
    </div>
  );
}
