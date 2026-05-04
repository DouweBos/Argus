import type { GitCommit } from "../../../lib/ipc";
import { useMemo } from "react";

interface AheadBehind {
  aheadSet: Set<string>;
  behindSet: Set<string>;
}

const EMPTY: AheadBehind = {
  aheadSet: new Set<string>(),
  behindSet: new Set<string>(),
};

export function useAheadBehind(commits: GitCommit[]): AheadBehind {
  return useMemo(() => {
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
      return EMPTY;
    }
    let remoteTipHash: string | null = null;
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
          r.endsWith(`/${localBranch}`),
      );
      if (remoteRef) {
        remoteTipHash = c.hash;
        break;
      }
    }
    if (!remoteTipHash || remoteTipHash === localTipHash) {
      return EMPTY;
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

    return { aheadSet: ahead, behindSet: behind };
  }, [commits]);
}
