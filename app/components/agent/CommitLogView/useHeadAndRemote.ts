import { useCallback, useEffect, useState } from "react";
import { gitGetRemotes, gitLog, type GitCommit } from "../../../lib/ipc";

interface HeadAndRemote {
  headHashes: Set<string>;
  isOtherCommitOnHead: (hash: string) => boolean;
  remoteUrl: string | null;
  tipHash: string | null;
}

export function useHeadAndRemote(
  sessionId: string,
  commits: GitCommit[],
): HeadAndRemote {
  const [tipHash, setTipHash] = useState<string | null>(null);
  const [headHashes, setHeadHashes] = useState<Set<string>>(() => new Set());
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  // Tip refetches on every commit-list refresh so it stays in sync with HEAD
  // after any mutation.
  useEffect(() => {
    gitLog(sessionId, 1, false)
      .then((c) => setTipHash(c[0]?.hash ?? null))
      .catch(() => setTipHash(null));
  }, [sessionId, commits]);

  // Refresh the set of HEAD-reachable commit hashes whenever the visible
  // commit list changes. We fetch enough rows to cover the visible window
  // plus a small buffer; reorder DnD only matters for commits the user can
  // see in the list.
  useEffect(() => {
    const limit = Math.max(commits.length, 50);
    let cancelled = false;
    gitLog(sessionId, limit, false)
      .then((cs) => {
        if (cancelled) {
          return;
        }
        setHeadHashes(new Set(cs.map((c) => c.hash)));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setHeadHashes(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, commits]);

  useEffect(() => {
    gitGetRemotes(sessionId)
      .then((rs) => setRemoteUrl(rs[0]?.url ?? null))
      .catch(() => setRemoteUrl(null));
  }, [sessionId]);

  const isOtherCommitOnHead = useCallback(
    (hash: string) => headHashes.has(hash),
    [headHashes],
  );

  return { tipHash, headHashes, remoteUrl, isOtherCommitOnHead };
}
