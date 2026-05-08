import type {
  CommitLogOperationsActions,
  CommitLogOperationsState,
} from "./useCommitLogOperations";
import type {
  BranchDialogResult,
  RebasePlanEntry,
  ResetDialogResult,
  TagDialogConfirm,
} from "@argus/peacock";
import {
  BranchDialog,
  ContextMenu,
  DestructiveConfirm,
  GitErrorBanner,
  Icons,
  RebaseEditor,
  ResetDialog,
  TagDialog,
} from "@argus/peacock";
import { GitError } from "../../../lib/gitError";
import {
  gitCherryPick,
  gitCreateBranch,
  gitCreateTag,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
  gitReset,
  gitRevert,
  type GitCommit,
} from "../../../lib/ipc";
import { setGitInteractiveRebaseView } from "../../../stores/editorStore";
import { setComparisonRange } from "../../../stores/gitUiStore";
import { CommitContextMenu } from "./CommitContextMenu";

interface CommitMenuState {
  commitIndex: number;
  x: number;
  y: number;
}

interface ShaMenuState {
  sha: string;
  x: number;
  y: number;
}

interface CommitDialogsProps {
  cherryPickTarget: GitCommit | null;
  commits: GitCommit[];
  contextMenu: CommitMenuState | null;
  createBranchTarget: GitCommit | null;
  createTagTarget: GitCommit | null;
  deleteTarget: GitCommit | null;
  ops: CommitLogOperationsActions & CommitLogOperationsState;
  remoteUrl: string | null;
  requestSquashSelection: () => void;
  resetDirectTarget: {
    commit: GitCommit;
    mode: "hard" | "mixed" | "soft";
  } | null;
  resetTarget: GitCommit | null;
  revertTarget: GitCommit | null;
  selectCommit: (idx: number) => Promise<void> | void;
  sessionId: string;
  setCherryPickTarget: (c: GitCommit | null) => void;
  setContextMenu: (state: CommitMenuState | null) => void;
  setCreateBranchTarget: (c: GitCommit | null) => void;
  setCreateTagTarget: (c: GitCommit | null) => void;
  setDeleteTarget: (c: GitCommit | null) => void;
  setResetDirectTarget: (
    t: { commit: GitCommit; mode: "hard" | "mixed" | "soft" } | null,
  ) => void;
  setResetTarget: (c: GitCommit | null) => void;
  setRevertTarget: (c: GitCommit | null) => void;
  setShaMenu: (state: ShaMenuState | null) => void;
  shaMenu: ShaMenuState | null;
  visibleSelectedHashes: Set<string>;
}

export function CommitDialogs({
  cherryPickTarget,
  commits,
  contextMenu,
  createBranchTarget,
  createTagTarget,
  deleteTarget,
  ops,
  remoteUrl,
  requestSquashSelection,
  resetDirectTarget,
  resetTarget,
  revertTarget,
  selectCommit,
  sessionId,
  setCherryPickTarget,
  setContextMenu,
  setCreateBranchTarget,
  setCreateTagTarget,
  setDeleteTarget,
  setResetDirectTarget,
  setResetTarget,
  setRevertTarget,
  setShaMenu,
  shaMenu,
  visibleSelectedHashes,
}: CommitDialogsProps) {
  return (
    <>
      {shaMenu && (
        <ContextMenu
          items={[
            {
              icon: <Icons.CopyIcon size={11} />,
              label: "Copy SHA",
              onClick: () => {
                navigator.clipboard
                  ?.writeText(shaMenu.sha)
                  .catch(() => undefined);
                setShaMenu(null);
              },
            },
            {
              icon: <Icons.CopyIcon size={11} />,
              label: "Copy short SHA",
              onClick: () => {
                navigator.clipboard
                  ?.writeText(shaMenu.sha.slice(0, 7))
                  .catch(() => undefined);
                setShaMenu(null);
              },
            },
          ]}
          position={{ x: shaMenu.x, y: shaMenu.y }}
          onClose={() => setShaMenu(null)}
        />
      )}

      {contextMenu && commits[contextMenu.commitIndex] && (
        <CommitContextMenu
          commit={commits[contextMenu.commitIndex]!}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          remoteUrl={remoteUrl}
          selectionCount={
            visibleSelectedHashes.has(commits[contextMenu.commitIndex]!.hash)
              ? visibleSelectedHashes.size
              : 1
          }
          onSquashSelection={
            visibleSelectedHashes.size >= 2
              ? () => {
                  setContextMenu(null);
                  requestSquashSelection();
                }
              : undefined
          }
          onClose={() => setContextMenu(null)}
          onCompareWithHead={(hash) => {
            setComparisonRange({ from: hash, to: "HEAD" });
            setContextMenu(null);
          }}
          onViewFiles={(hash) => {
            const idx = commits.findIndex((c) => c.hash === hash);
            if (idx >= 0) {
              selectCommit(idx);
            }
            setContextMenu(null);
          }}
          onResetHere={(c) => {
            setResetTarget(c);
            setContextMenu(null);
          }}
          onResetSoft={(c) => {
            setResetDirectTarget({ commit: c, mode: "soft" });
            setContextMenu(null);
          }}
          onResetMixed={(c) => {
            setResetDirectTarget({ commit: c, mode: "mixed" });
            setContextMenu(null);
          }}
          onResetHard={(c) => {
            setResetDirectTarget({ commit: c, mode: "hard" });
            setContextMenu(null);
          }}
          onRevert={(c) => {
            setRevertTarget(c);
            setContextMenu(null);
          }}
          onDelete={(c) => {
            setDeleteTarget(c);
            setContextMenu(null);
          }}
          onCherryPick={(c) => {
            setCherryPickTarget(c);
            setContextMenu(null);
          }}
          onCreateBranch={(c) => {
            setCreateBranchTarget(c);
            setContextMenu(null);
          }}
          onCreateTag={(c) => {
            setCreateTagTarget(c);
            setContextMenu(null);
          }}
          onInteractiveRebase={(c, action) => {
            setContextMenu(null);
            ops.openRebaseEditor(c, action);
          }}
          onInteractiveRebaseFromHere={(c) => {
            setContextMenu(null);
            setGitInteractiveRebaseView(`${c.hash}^`);
          }}
        />
      )}

      {ops.rebaseState && (
        <RebaseEditor
          open
          baseRef={ops.rebaseState.baseRef}
          commits={ops.rebaseState.commits.map((c) => ({
            hash: c.hash,
            subject: c.subject,
            author: c.author,
          }))}
          onCancel={() => ops.setRebaseState(null)}
          onConfirm={async (rawPlan) => {
            const upstream = ops.rebaseState!.upstream;
            const targetHash = ops.rebaseState!.targetHash;
            const initialAction = ops.rebaseState!.initialAction;
            const plan: RebasePlanEntry[] = rawPlan.map((entry) => {
              if (
                entry.hash === targetHash &&
                entry.action === "pick" &&
                initialAction !== "pick"
              ) {
                return { ...entry, action: initialAction };
              }

              return entry;
            });
            ops.setRebaseState(null);
            try {
              await gitRebaseInteractiveRun(sessionId, {
                upstream,
                plan,
              });
            } catch (err) {
              if (err instanceof GitError) {
                ops.setOpBanner({ kind: err.kind, message: err.message });
              } else {
                ops.setOpBanner({
                  kind: "unknown",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }}
        />
      )}

      {ops.opBanner && (
        <GitErrorBanner
          kind={ops.opBanner.kind}
          message={ops.opBanner.message}
          onAction={(actionId) => {
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(ops.opBanner!.message)
                .catch(() => undefined);
            }
            ops.setOpBanner(null);
          }}
          onDismiss={() => ops.setOpBanner(null)}
        />
      )}

      {resetTarget && (
        <ResetDialog
          open
          targetRef={resetTarget.abbreviatedHash}
          targetSubject={resetTarget.subject}
          onCancel={() => setResetTarget(null)}
          onConfirm={async (r: ResetDialogResult) => {
            const target = resetTarget;
            setResetTarget(null);
            if (!target) {
              return;
            }
            try {
              await gitReset(sessionId, { ref: target.hash, mode: r.mode });
            } catch (err) {
              if (err instanceof GitError) {
                ops.setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
        />
      )}

      <DestructiveConfirm
        open={Boolean(ops.commitDropConfirm)}
        title={(() => {
          if (!ops.commitDropConfirm) {
            return "";
          }

          return ops.commitDropConfirm.fixup
            ? `Fixup commit?`
            : `Squash commits?`;
        })()}
        description={(() => {
          if (!ops.commitDropConfirm) {
            return "";
          }
          const { source, target, fixup } = ops.commitDropConfirm;
          if (fixup) {
            return `Fold "${source.subject}" into "${target.subject}", discarding the source's commit message. This rewrites history.`;
          }

          return `Combine "${source.subject}" into "${target.subject}", merging both messages. This rewrites history.`;
        })()}
        confirmLabel={ops.commitDropConfirm?.fixup ? "Fixup" : "Squash"}
        tone="warning"
        onConfirm={async () => {
          const target = ops.commitDropConfirm;
          ops.setCommitDropConfirm(null);
          if (!target) {
            return;
          }
          await ops.runCommitDropOnto(
            target.source,
            target.target,
            target.fixup,
          );
        }}
        onCancel={() => ops.setCommitDropConfirm(null)}
      />

      <DestructiveConfirm
        open={Boolean(ops.reorderConfirm)}
        title="Reorder commits?"
        description={
          ops.reorderConfirm
            ? `Move "${ops.reorderConfirm.source.subject}" ${ops.reorderConfirm.position} "${ops.reorderConfirm.target.subject}". This rewrites history.`
            : ""
        }
        confirmLabel="Reorder"
        tone="warning"
        onConfirm={async () => {
          const target = ops.reorderConfirm;
          ops.setReorderConfirm(null);
          if (!target) {
            return;
          }
          await ops.runCommitReorder(
            target.source,
            target.target,
            target.position,
          );
        }}
        onCancel={() => ops.setReorderConfirm(null)}
      />

      <DestructiveConfirm
        open={Boolean(ops.squashConfirm)}
        title={
          ops.squashConfirm
            ? `Squash ${ops.squashConfirm.commits.length} commits into one?`
            : ""
        }
        description={
          ops.squashConfirm
            ? `Combine ${ops.squashConfirm.commits.length} commits — from "${ops.squashConfirm.commits[0]!.subject}" back to "${ops.squashConfirm.commits[ops.squashConfirm.commits.length - 1]!.subject}" — into a single commit. This rewrites history.`
            : ""
        }
        confirmLabel="Squash"
        tone="warning"
        onConfirm={async () => {
          const target = ops.squashConfirm;
          ops.setSquashConfirm(null);
          if (!target) {
            return;
          }
          await ops.runSquashSelection(target.commits);
        }}
        onCancel={() => ops.setSquashConfirm(null)}
      />

      <DestructiveConfirm
        open={Boolean(revertTarget)}
        title="Revert commit?"
        description={
          revertTarget
            ? `Create a new commit that undoes ${revertTarget.abbreviatedHash} — ${revertTarget.subject}`
            : ""
        }
        confirmLabel="Revert"
        tone="warning"
        onConfirm={async () => {
          const target = revertTarget;
          setRevertTarget(null);
          if (!target) {
            return;
          }
          try {
            await gitRevert(sessionId, { hash: target.hash });
          } catch (err) {
            if (err instanceof GitError) {
              ops.setOpBanner({ kind: err.kind, message: err.message });
            }
          }
        }}
        onCancel={() => setRevertTarget(null)}
      />

      <DestructiveConfirm
        open={Boolean(deleteTarget)}
        title="Delete commit?"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.abbreviatedHash} — ${deleteTarget.subject} — from history. This rewrites history; later commits will be replayed on top.`
            : ""
        }
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={async () => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) {
            return;
          }
          ops.setOpBanner(null);
          try {
            const upstream = `${target.hash}^`;
            const plan = await gitRebaseInteractivePlan(sessionId, {
              upstream,
            });
            const planEntries: RebasePlanEntry[] = plan.map((c) => ({
              hash: c.hash,
              action: c.hash === target.hash ? "drop" : "pick",
            }));
            await gitRebaseInteractiveRun(sessionId, {
              upstream,
              plan: planEntries,
            });
          } catch (err) {
            if (err instanceof GitError) {
              ops.setOpBanner({ kind: err.kind, message: err.message });
            } else {
              ops.setOpBanner({
                kind: "unknown",
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <DestructiveConfirm
        open={Boolean(cherryPickTarget)}
        title="Cherry-pick onto current branch?"
        description={
          cherryPickTarget
            ? `Apply ${cherryPickTarget.abbreviatedHash} — ${cherryPickTarget.subject} — onto the current branch.`
            : ""
        }
        confirmLabel="Cherry-pick"
        tone="warning"
        onConfirm={async () => {
          const target = cherryPickTarget;
          setCherryPickTarget(null);
          if (!target) {
            return;
          }
          try {
            await gitCherryPick(sessionId, { hash: target.hash });
          } catch (err) {
            if (err instanceof GitError) {
              ops.setOpBanner({ kind: err.kind, message: err.message });
            }
          }
        }}
        onCancel={() => setCherryPickTarget(null)}
      />

      {/* Direct reset — mode pre-selected from context menu; Hard shows danger confirm. */}
      <DestructiveConfirm
        open={Boolean(resetDirectTarget && resetDirectTarget.mode === "hard")}
        title="Hard reset — discard all changes?"
        description={
          resetDirectTarget
            ? `Reset HEAD to ${resetDirectTarget.commit.abbreviatedHash} — ${resetDirectTarget.commit.subject}. Uncommitted changes will be permanently lost.`
            : ""
        }
        confirmLabel="Hard Reset"
        tone="destructive"
        onConfirm={async () => {
          const target = resetDirectTarget;
          setResetDirectTarget(null);
          if (!target) {
            return;
          }
          try {
            await gitReset(sessionId, {
              ref: target.commit.hash,
              mode: "hard",
            });
          } catch (err) {
            if (err instanceof GitError) {
              ops.setOpBanner({ kind: err.kind, message: err.message });
            }
          }
        }}
        onCancel={() => setResetDirectTarget(null)}
      />

      {resetDirectTarget && resetDirectTarget.mode !== "hard" && (
        <ResetDialog
          open
          targetRef={resetDirectTarget.commit.abbreviatedHash}
          targetSubject={resetDirectTarget.commit.subject}
          defaultMode={resetDirectTarget.mode}
          onCancel={() => setResetDirectTarget(null)}
          onConfirm={async (r: ResetDialogResult) => {
            const target = resetDirectTarget;
            setResetDirectTarget(null);
            if (!target) {
              return;
            }
            try {
              await gitReset(sessionId, {
                ref: target.commit.hash,
                mode: r.mode,
              });
            } catch (err) {
              if (err instanceof GitError) {
                ops.setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
        />
      )}

      {createBranchTarget && (
        <BranchDialog
          open
          currentBranch={createBranchTarget.abbreviatedHash}
          defaultStartPoint={createBranchTarget.hash}
          defaultSwitchTo={false}
          onConfirm={async (r: BranchDialogResult) => {
            const target = createBranchTarget;
            setCreateBranchTarget(null);
            try {
              await gitCreateBranch(sessionId, {
                name: r.name,
                startPoint: target.hash,
                checkout: r.switchTo,
              });
            } catch (err) {
              if (err instanceof GitError) {
                ops.setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
          onCancel={() => setCreateBranchTarget(null)}
        />
      )}

      {createTagTarget && (
        <TagDialog
          open
          mode="create"
          defaultRef={createTagTarget.hash}
          onConfirm={async (opts: TagDialogConfirm) => {
            const target = createTagTarget;
            setCreateTagTarget(null);
            try {
              await gitCreateTag(sessionId, {
                name: opts.name,
                ref: target.hash,
                message: opts.message,
                sign: opts.sign,
              });
            } catch (err) {
              if (err instanceof GitError) {
                ops.setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
          onCancel={() => setCreateTagTarget(null)}
        />
      )}
    </>
  );
}
