import type { RebaseSingleAction } from "./CommitContextMenu";
import type { RebasePlanCommit } from "../../../lib/ipc";
import type {
  GitErrorKind,
  RebaseAction,
  RebasePlanEntry,
} from "@argus/peacock";
import { useCallback, useMemo, useState } from "react";
import { GitError } from "../../../lib/gitError";
import {
  gitRebaseAutosquash,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
  type GitCommit,
} from "../../../lib/ipc";
import { detectAutosquash } from "./autosquash";

export interface CommitLogOperationsState {
  autosquash: ReturnType<typeof detectAutosquash>;
  autosquashRunning: boolean;
  autosquashSignature: string | null;
  commitDropConfirm: {
    fixup: boolean;
    source: GitCommit;
    target: GitCommit;
  } | null;
  opBanner: { kind: GitErrorKind; message: string } | null;
  rebaseState: {
    baseRef: string;
    commits: RebasePlanCommit[];
    initialAction: RebaseAction;
    targetHash: string;
    upstream: string;
  } | null;
  reorderConfirm: {
    position: "above" | "below";
    source: GitCommit;
    target: GitCommit;
  } | null;
  squashConfirm: { commits: GitCommit[] } | null;
}

export interface CommitLogOperationsActions {
  handleAutosquash: () => Promise<void>;
  handleInteractiveRebaseFromHere: (commit: GitCommit) => Promise<void>;
  openRebaseEditor: (
    commit: GitCommit,
    action: RebaseSingleAction,
  ) => Promise<void>;
  runCommitDropOnto: (
    source: GitCommit,
    target: GitCommit,
    fixup: boolean,
  ) => Promise<void>;
  runCommitReorder: (
    source: GitCommit,
    target: GitCommit,
    position: "above" | "below",
  ) => Promise<void>;
  runSquashSelection: (picked: GitCommit[]) => Promise<void>;
  setCommitDropConfirm: React.Dispatch<
    React.SetStateAction<CommitLogOperationsState["commitDropConfirm"]>
  >;
  setOpBanner: React.Dispatch<
    React.SetStateAction<CommitLogOperationsState["opBanner"]>
  >;
  setRebaseState: React.Dispatch<
    React.SetStateAction<CommitLogOperationsState["rebaseState"]>
  >;
  setReorderConfirm: React.Dispatch<
    React.SetStateAction<CommitLogOperationsState["reorderConfirm"]>
  >;
  setSquashConfirm: React.Dispatch<
    React.SetStateAction<CommitLogOperationsState["squashConfirm"]>
  >;
}

export function useCommitLogOperations(
  sessionId: string,
  commits: GitCommit[],
  headHashes: Set<string>,
  onSelectionChange: (hashes: Set<string>) => void,
): CommitLogOperationsActions & CommitLogOperationsState {
  const [opBanner, setOpBanner] = useState<{
    kind: GitErrorKind;
    message: string;
  } | null>(null);
  const [rebaseState, setRebaseState] = useState<{
    baseRef: string;
    commits: RebasePlanCommit[];
    initialAction: RebaseAction;
    targetHash: string;
    upstream: string;
  } | null>(null);
  const [squashConfirm, setSquashConfirm] = useState<{
    commits: GitCommit[];
  } | null>(null);
  const [commitDropConfirm, setCommitDropConfirm] = useState<{
    fixup: boolean;
    source: GitCommit;
    target: GitCommit;
  } | null>(null);
  const [reorderConfirm, setReorderConfirm] = useState<{
    position: "above" | "below";
    source: GitCommit;
    target: GitCommit;
  } | null>(null);
  const [autosquashRunning, setAutosquashRunning] = useState(false);

  const autosquash = useMemo(
    () => detectAutosquash(commits, headHashes),
    [commits, headHashes],
  );
  const autosquashSignature = useMemo(() => {
    if (!autosquash) {
      return null;
    }
    const hashes: string[] = [];
    for (const c of commits) {
      if (
        headHashes.has(c.hash) &&
        /^(?:fixup|squash|amend)!\s+/.test(c.subject)
      ) {
        hashes.push(c.hash);
      }
    }

    return hashes.sort().join(",");
  }, [commits, headHashes, autosquash]);

  const handleAutosquash = useCallback(async () => {
    if (!autosquash) {
      return;
    }
    setOpBanner(null);
    const upstream = autosquash.oldestTarget.parentHash
      ? autosquash.oldestTarget.parentHash
      : `${autosquash.oldestTarget.hash}^`;
    setAutosquashRunning(true);
    try {
      await gitRebaseAutosquash(sessionId, { upstream });
    } catch (err) {
      if (err instanceof GitError) {
        setOpBanner({ kind: err.kind, message: err.message });
      } else {
        setOpBanner({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setAutosquashRunning(false);
    }
  }, [autosquash, sessionId]);

  const openRebaseEditor = useCallback(
    async (commit: GitCommit, action: RebaseSingleAction) => {
      setOpBanner(null);
      try {
        const upstream = `${commit.hash}^`;
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        setRebaseState({
          baseRef: upstream,
          commits: plan,
          initialAction: action,
          targetHash: commit.hash,
          upstream,
        });
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId],
  );

  const handleInteractiveRebaseFromHere = useCallback(
    async (commit: GitCommit) => {
      setOpBanner(null);
      try {
        const upstream = `${commit.hash}^`;
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        setRebaseState({
          baseRef: upstream,
          commits: plan,
          initialAction: "pick",
          targetHash: commit.hash,
          upstream,
        });
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId],
  );

  const runSquashSelection = useCallback(
    async (picked: GitCommit[]) => {
      if (picked.length < 2) {
        return;
      }
      const oldest = picked[picked.length - 1]!;
      const upstream = `${oldest.hash}^`;
      try {
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        const selectedSet = new Set(picked.map((c) => c.hash));
        const selectedEntries: RebasePlanEntry[] = [];
        const unselectedEntries: RebasePlanEntry[] = [];
        for (const c of plan) {
          if (selectedSet.has(c.hash)) {
            selectedEntries.push({
              hash: c.hash,
              action: c.hash === oldest.hash ? "pick" : "squash",
            });
          } else {
            unselectedEntries.push({ hash: c.hash, action: "pick" });
          }
        }
        const planEntries: RebasePlanEntry[] = [
          ...selectedEntries,
          ...unselectedEntries,
        ];
        await gitRebaseInteractiveRun(sessionId, {
          upstream,
          plan: planEntries,
        });
        onSelectionChange(new Set([oldest.hash]));
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId, onSelectionChange],
  );

  const runCommitDropOnto = useCallback(
    async (source: GitCommit, target: GitCommit, fixup: boolean) => {
      if (source.hash === target.hash) {
        return;
      }
      const srcIdx = commits.findIndex((c) => c.hash === source.hash);
      const tgtIdx = commits.findIndex((c) => c.hash === target.hash);
      if (srcIdx < 0 || tgtIdx < 0) {
        return;
      }
      const deepestIdx = Math.max(srcIdx, tgtIdx);
      const upstream = `${commits[deepestIdx]!.hash}^`;
      try {
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        const sourceEntry = plan.find((p) => p.hash === source.hash);
        const targetIdxInPlan = plan.findIndex((p) => p.hash === target.hash);
        if (!sourceEntry || targetIdxInPlan < 0) {
          setOpBanner({
            kind: "unknown",
            message: "Commit not found in rebase plan.",
          });

          return;
        }
        const without = plan.filter((p) => p.hash !== source.hash);
        const newTargetIdx = without.findIndex((p) => p.hash === target.hash);
        const reordered = [
          ...without.slice(0, newTargetIdx + 1),
          sourceEntry,
          ...without.slice(newTargetIdx + 1),
        ];
        const action: RebaseAction = fixup ? "fixup" : "squash";
        const planEntries: RebasePlanEntry[] = reordered.map((c) => ({
          hash: c.hash,
          action: c.hash === source.hash ? action : "pick",
        }));
        await gitRebaseInteractiveRun(sessionId, {
          upstream,
          plan: planEntries,
        });
        onSelectionChange(new Set([target.hash]));
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId, commits, onSelectionChange],
  );

  const runCommitReorder = useCallback(
    async (
      source: GitCommit,
      target: GitCommit,
      position: "above" | "below",
    ) => {
      if (source.hash === target.hash) {
        return;
      }
      const srcIdx = commits.findIndex((c) => c.hash === source.hash);
      const tgtIdx = commits.findIndex((c) => c.hash === target.hash);
      if (srcIdx < 0 || tgtIdx < 0) {
        return;
      }
      if (position === "above" && tgtIdx === srcIdx + 1) {
        return;
      }
      if (position === "above" && tgtIdx === srcIdx) {
        return;
      }
      if (position === "below" && tgtIdx === srcIdx - 1) {
        return;
      }
      const deepestIdx = Math.max(
        srcIdx,
        position === "below" ? tgtIdx : tgtIdx,
      );
      const upstream = `${commits[deepestIdx]!.hash}^`;
      try {
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        const sourceEntry = plan.find((p) => p.hash === source.hash);
        if (!sourceEntry) {
          setOpBanner({
            kind: "unknown",
            message: "Source commit not found in rebase plan.",
          });

          return;
        }
        const without = plan.filter((p) => p.hash !== source.hash);
        const targetIdxInWithout = without.findIndex(
          (p) => p.hash === target.hash,
        );
        if (targetIdxInWithout < 0) {
          setOpBanner({
            kind: "unknown",
            message: "Target commit not found in rebase plan.",
          });

          return;
        }
        const insertAt =
          position === "above" ? targetIdxInWithout + 1 : targetIdxInWithout;
        const reordered = [
          ...without.slice(0, insertAt),
          sourceEntry,
          ...without.slice(insertAt),
        ];
        const planEntries: RebasePlanEntry[] = reordered.map((c) => ({
          hash: c.hash,
          action: "pick" as RebaseAction,
        }));
        await gitRebaseInteractiveRun(sessionId, {
          upstream,
          plan: planEntries,
        });
        onSelectionChange(new Set([source.hash]));
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId, commits, onSelectionChange],
  );

  return {
    autosquash,
    autosquashRunning,
    autosquashSignature,
    commitDropConfirm,
    handleAutosquash,
    handleInteractiveRebaseFromHere,
    openRebaseEditor,
    opBanner,
    rebaseState,
    reorderConfirm,
    runCommitDropOnto,
    runCommitReorder,
    runSquashSelection,
    setCommitDropConfirm,
    setOpBanner,
    setRebaseState,
    setReorderConfirm,
    setSquashConfirm,
    squashConfirm,
  };
}
