/**
 * What a branch's menu does, for the branches list and a branch's own
 * screen: the menu itself, its confirmations, the new-branch and rename
 * sheets, and the note or error the last move left. The TS twin of
 * ArgusUI's `BranchActions` + `.branchActionPrompts`.
 */

import type { RemoteGitBranch } from "@argus/remote-protocol";
import { type ReactNode, useState } from "react";
import {
  type BranchAction,
  type BranchConfirm,
  branchMenu,
  branchPrompt,
  branchRef,
  branchStartPoints,
  describeError,
} from "@argus/client-core";
import {
  BranchDialog,
  Button,
  ConfirmDialog,
  type ContextMenuItem,
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
} from "@argus/peacock";
import { useBranchesStore } from "../../stores/branches";
import { branchPullRequestUrl } from "../../stores/branches";

interface Prompt {
  branch: RemoteGitBranch;
  confirm: BranchConfirm;
}

type Sheet =
  | { kind: "create"; from: string | null }
  | { kind: "rename"; branch: RemoteGitBranch };

export interface BranchActions {
  busy: boolean;
  /** What the last move did, or why it failed. */
  note: { error: boolean; text: string } | null;
  clearNote: () => void;
  /** The branch's menu, as Peacock `ContextMenu` items. */
  menuItems: (branch: RemoteGitBranch) => ContextMenuItem[];
  run: (branch: RemoteGitBranch, action: BranchAction) => void;
  newBranch: (from?: string | null) => void;
  /** The prompts and sheets; render once beside the screen. */
  prompts: ReactNode;
}

export function useBranchActions({
  branches,
  canAct,
  onCompare,
  onDeleted,
  onRenamed,
  sessionId,
}: {
  branches: RemoteGitBranch[];
  /** Holds `control` on a project root: the computer accepts the moves. */
  canAct: boolean;
  onCompare?: (branch: RemoteGitBranch) => void;
  onDeleted?: (branch: RemoteGitBranch) => void;
  onRenamed?: (branch: RemoteGitBranch, name: string) => void;
  sessionId: string;
}): BranchActions {
  const store = useBranchesStore.getState();
  const current = branches.find((b) => b.is_current)?.name ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<BranchActions["note"]>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  async function attempt(done: string | null, call: () => Promise<unknown>) {
    setBusy(true);
    setNote(null);
    try {
      await call();
      if (done) {
        setNote({ error: false, text: done });
      }
    } catch (err) {
      setNote({ error: true, text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  function checkout(branch: RemoteGitBranch, dirty?: "stash") {
    void attempt(null, async () => {
      const outcome = await store.checkout(sessionId, branchRef(branch), dirty);
      if (outcome === "dirty") {
        setPrompt({ branch, confirm: { kind: "dirty" } });
      } else {
        setNote({ error: false, text: `Switched to ${branch.name}.` });
      }
    });
  }

  function remove(branch: RemoteGitBranch, force: boolean) {
    void attempt(null, async () => {
      const outcome = await store.remove(sessionId, branch.name, force);
      if (outcome === "unmerged") {
        setPrompt({ branch, confirm: { kind: "delete", unmerged: true } });
      } else {
        setNote({ error: false, text: `Deleted ${branch.name}.` });
        onDeleted?.(branch);
      }
    });
  }

  function push(branch: RemoteGitBranch, force: boolean) {
    void attempt(`Pushed ${branch.name}.`, () =>
      store.push(sessionId, branch, force),
    );
  }

  function run(branch: RemoteGitBranch, action: BranchAction) {
    switch (action.kind) {
      case "checkout":
        checkout(branch);
        break;
      case "newBranch":
        setSheet({ kind: "create", from: branchRef(branch) });
        break;
      case "merge":
        setPrompt({ branch, confirm: { kind: "merge", squash: action.squash } });
        break;
      case "rebase":
        setPrompt({ branch, confirm: { kind: "rebase" } });
        break;
      case "compare":
        onCompare?.(branch);
        break;
      case "push":
        push(branch, false);
        break;
      case "forcePush":
        setPrompt({ branch, confirm: { kind: "forcePush" } });
        break;
      case "pull":
        void attempt(`Pulled into ${branch.name}.`, () =>
          store.pull(sessionId, action.strategy),
        );
        break;
      case "openPullRequest":
        void attempt(null, async () => {
          const url = await branchPullRequestUrl(sessionId, branch.name);
          if (!url) {
            throw new Error("This repo has no GitHub remote.");
          }
          window.open(url, "_blank", "noopener,noreferrer");
        });
        break;
      case "pin":
        void attempt(null, () =>
          store.setPinned(sessionId, branch.name, !branch.pinned),
        );
        break;
      case "rename":
        setSheet({ kind: "rename", branch });
        break;
      case "copyName":
        void navigator.clipboard?.writeText(branch.name).catch(() => {});
        break;
      case "delete":
        setPrompt({ branch, confirm: { kind: "delete", unmerged: false } });
        break;
    }
  }

  /** What a confirmed prompt does. */
  function confirm({ branch, confirm: c }: Prompt): Promise<void> {
    setPrompt(null);
    switch (c.kind) {
      case "merge":
        return attempt(
          c.squash
            ? `Squashed ${branch.name} into ${current ?? "the current branch"}.`
            : `Merged ${branch.name} into ${current ?? "the current branch"}.`,
          () => store.merge(sessionId, branchRef(branch), c.squash),
        );
      case "rebase":
        return attempt(`Rebased onto ${branch.name}.`, () =>
          store.rebase(sessionId, branchRef(branch)),
        );
      case "forcePush":
        push(branch, true);
        break;
      case "delete":
        remove(branch, c.unmerged);
        break;
      case "dirty":
        checkout(branch, "stash");
        break;
    }

    return Promise.resolve();
  }

  function menuItems(branch: RemoteGitBranch): ContextMenuItem[] {
    const sections = branchMenu(branch, {
      current,
      canCompare: Boolean(onCompare) && current !== null,
    }).filter(
      // Without control only the moves that read survive.
      (s) => canAct || s.group === "manage" || s.group === "integrate",
    );
    const items: ContextMenuItem[] = [];
    for (const section of sections) {
      const entries = section.items.filter(
        (i) =>
          canAct ||
          i.action.kind === "compare" ||
          i.action.kind === "copyName",
      );
      if (entries.length === 0) {
        continue;
      }
      if (items.length > 0) {
        items.push({ separator: true });
      }
      for (const item of entries) {
        items.push({
          label: item.label,
          danger: item.danger,
          disabled: item.disabled || busy,
          onClick: item.children ? undefined : () => run(branch, item.action),
          children: item.children?.map((child) => ({
            label: child.label,
            onClick: () => run(branch, child.action),
          })),
        });
      }
    }

    return items;
  }

  const text = prompt
    ? branchPrompt(prompt.confirm, prompt.branch.name, current)
    : null;

  const prompts = (
    <>
      {prompt && text && (
        <ConfirmDialog
          title={text.title}
          titleId="aw-branch-prompt"
          confirmLabel={text.confirmLabel}
          destructive={text.destructive}
          onCancel={() => setPrompt(null)}
          onConfirm={() => confirm(prompt)}
        >
          {text.message}
        </ConfirmDialog>
      )}
      <BranchDialog
        open={sheet?.kind === "create"}
        currentBranch={current ?? "HEAD"}
        branchOptions={branchStartPoints(
          branches,
          sheet?.kind === "create" ? sheet.from : null,
        )}
        defaultStartPoint={
          sheet?.kind === "create" ? (sheet.from ?? undefined) : undefined
        }
        onCancel={() => setSheet(null)}
        onConfirm={({ name, startPoint, switchTo }) => {
          setSheet(null);
          void attempt(`Created ${name}.`, () =>
            store.create(sessionId, name, startPoint || null, switchTo),
          );
        }}
      />
      {sheet?.kind === "rename" && (
        <RenameDialog
          initial={sheet.branch.name}
          onCancel={() => setSheet(null)}
          onSave={(name) => {
            const branch = sheet.branch;
            setSheet(null);
            void attempt(`Renamed to ${name}.`, async () => {
              await store.rename(sessionId, branch.name, name);
              onRenamed?.(branch, name);
            });
          }}
        />
      )}
    </>
  );

  return {
    busy,
    note,
    clearNote: () => setNote(null),
    menuItems,
    run,
    newBranch: (from = null) => setSheet({ kind: "create", from }),
    prompts,
  };
}

function RenameDialog({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial;

  return (
    <Dialog title={`Rename ${initial}`} titleId="aw-branch-rename" onClose={onCancel}>
      <DialogBody>
        <Input
          autoFocus
          mono
          aria-label="Branch name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) {
              onSave(trimmed);
            }
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canSave}
          onClick={() => onSave(trimmed)}
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
