import type { GitCommit } from "../../../lib/ipc";
import { useEffect, useMemo, useState } from "react";
import { gitCompareBranches } from "../../../lib/ipc";

interface AheadBehind {
  aheadSet: Set<string>;
  behindSet: Set<string>;
}

const EMPTY: AheadBehind = {
  aheadSet: new Set<string>(),
  behindSet: new Set<string>(),
};

interface InMemoryResult extends AheadBehind {
  /** Local branch name extracted from the HEAD-> ref, or null. */
  localBranch: string | null;
  /** True when in-memory ref scan resolved an upstream — even if the diff is
   *  empty (in sync). Used to decide whether the IPC fallback should run. */
  resolvedUpstream: boolean;
}

function computeInMemory(
  commits: GitCommit[],
  fallbackBranch: string | null | undefined,
): InMemoryResult {
  let localBranch: string | null = null;
  let localTipHash: string | null = null;
  for (const c of commits) {
    if (!c.refs) {
      continue;
    }
    const refs = c.refs.split(",").map((r) => r.trim());
    const headRef = refs.find((r) => r.startsWith("HEAD ->"));
    if (headRef) {
      localBranch = headRef.replace(/^HEAD ->\s*/, "").trim();
      localTipHash = c.hash;
      break;
    }
  }
  if (!localBranch || !localTipHash) {
    return { ...EMPTY, localBranch: null, resolvedUpstream: false };
  }
  const findRemoteTip = (branchName: string): string | null => {
    for (const c of commits) {
      if (!c.refs) {
        continue;
      }
      const refs = c.refs.split(",").map((r) => r.trim());
      const remoteRef = refs.find(
        (r) =>
          !r.startsWith("HEAD") &&
          !r.startsWith("tag:") &&
          r.includes("/") &&
          r.endsWith(`/${branchName}`),
      );
      if (remoteRef) {
        return c.hash;
      }
    }

    return null;
  };
  // Prefer the local branch's own upstream when present (e.g. `origin/main`
  // for `main`). Sessions usually run on a never-pushed branch with no such
  // upstream — fall back to the base branch's remote (e.g. `origin/main`)
  // so unpushed work still surfaces as ahead, and base-branch advances
  // surface as behind.
  let remoteTipHash = findRemoteTip(localBranch);
  if (!remoteTipHash && fallbackBranch && fallbackBranch !== localBranch) {
    remoteTipHash = findRemoteTip(fallbackBranch);
  }
  if (!remoteTipHash) {
    return { ...EMPTY, localBranch, resolvedUpstream: false };
  }
  if (remoteTipHash === localTipHash) {
    return { ...EMPTY, localBranch, resolvedUpstream: true };
  }
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const walk = (start: string) => {
    const visited = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const h = stack.pop()!;
      if (visited.has(h)) {
        continue;
      }
      visited.add(h);
      const c = byHash.get(h);
      if (!c?.parentHash) {
        continue;
      }
      for (const p of c.parentHash.split(" ").filter(Boolean)) {
        if (!visited.has(p)) {
          stack.push(p);
        }
      }
    }

    return visited;
  };
  const localReach = walk(localTipHash);
  const remoteReach = walk(remoteTipHash);
  const ahead = new Set<string>();
  const behind = new Set<string>();
  for (const h of localReach) {
    if (!remoteReach.has(h)) {
      ahead.add(h);
    }
  }
  for (const h of remoteReach) {
    if (!localReach.has(h)) {
      behind.add(h);
    }
  }

  return {
    aheadSet: ahead,
    behindSet: behind,
    localBranch,
    resolvedUpstream: true,
  };
}

/**
 * Compute per-commit ahead/behind state vs. the local branch's upstream.
 *
 * Two-tier strategy:
 *
 * 1. **In-memory ref scan** — fast, no IPC. Works when the loaded commit list
 *    contains the upstream ref decoration (e.g. HistoryView with allBranches
 *    on `main`, where `origin/main` is loaded). Falls back to the base
 *    branch's remote when the local branch has no own upstream.
 * 2. **IPC compare fallback** — when the in-memory scan can't resolve an
 *    upstream (e.g. BranchView, which loads only HEAD-reachable commits and
 *    therefore never sees `origin/<branch>` refs). Calls
 *    `gitCompareBranches` against `origin/<localBranch>` and falls back to
 *    `origin/<fallbackBranch>` so unpushed session branches still surface
 *    their ahead/behind state.
 */
export function useAheadBehind(
  sessionId: string,
  commits: GitCommit[],
  fallbackBranch?: string | null,
): AheadBehind {
  const inMemory = useMemo(
    () => computeInMemory(commits, fallbackBranch),
    [commits, fallbackBranch],
  );

  const needsIpc = !inMemory.resolvedUpstream && inMemory.localBranch !== null;
  const localBranch = inMemory.localBranch;
  // Re-poll on commit-list churn so newly fetched/pushed commits update sync
  // state without needing a panel remount.
  const tipHash = commits[0]?.hash ?? null;
  const ipcKey = needsIpc
    ? `${sessionId}|${localBranch}|${fallbackBranch ?? ""}|${tipHash ?? ""}`
    : "";

  const [ipc, setIpc] = useState<{ key: string; result: AheadBehind }>({
    key: "",
    result: EMPTY,
  });

  useEffect(() => {
    if (!ipcKey || !localBranch) {
      return;
    }
    let cancelled = false;
    const candidates: string[] = [`origin/${localBranch}`];
    if (fallbackBranch && fallbackBranch !== localBranch) {
      candidates.push(`origin/${fallbackBranch}`);
    }
    (async () => {
      for (const right of candidates) {
        try {
          const res = await gitCompareBranches(sessionId, "HEAD", right);
          if (cancelled) {
            return;
          }
          const ahead = new Set(res.leftOnly.map((c) => c.hash));
          const behind = new Set(res.rightOnly.map((c) => c.hash));
          if (ahead.size > 0 || behind.size > 0 || res.mergeBase) {
            setIpc({
              key: ipcKey,
              result: { aheadSet: ahead, behindSet: behind },
            });

            return;
          }
        } catch {
          // try next candidate
        }
      }
      if (!cancelled) {
        setIpc({ key: ipcKey, result: EMPTY });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ipcKey, sessionId, localBranch, fallbackBranch]);

  if (inMemory.resolvedUpstream) {
    return { aheadSet: inMemory.aheadSet, behindSet: inMemory.behindSet };
  }
  // Only trust the IPC result if it was computed for the current key — guards
  // against showing stale ahead/behind data after the session/branch changed
  // but before the new fetch resolves.
  if (ipc.key === ipcKey) {
    return ipc.result;
  }

  return EMPTY;
}
