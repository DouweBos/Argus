/**
 * A project root's branches as the Mac's branch menu sees them: the ref git
 * resolves, the list's sections, what each branch's menu offers and how each
 * confirmation reads. Port of ArgusUI's `BranchActions` / `BranchMenuSections`
 * logic, so the web and the phone offer the same moves in the same order.
 */

import type { RemoteGitBranch } from "@argus/remote-protocol";

/** `origin/x` for a branch that only exists remotely, else its name. */
export function branchRef(branch: RemoteGitBranch): string {
  return branch.scope === "remote"
    ? `${branch.remote ?? "origin"}/${branch.name}`
    : branch.name;
}

/** Unique across scopes: a local `main` and a remote-only `main` differ. */
export function branchId(branch: RemoteGitBranch): string {
  return `${branch.scope}:${branch.name}`;
}

export function filterBranches(
  branches: readonly RemoteGitBranch[],
  filter: string,
): RemoteGitBranch[] {
  const needle = filter.trim().toLowerCase();

  return needle
    ? branches.filter((b) => b.name.toLowerCase().includes(needle))
    : [...branches];
}

export interface BranchSection {
  branches: RemoteGitBranch[];
  scope: "local" | "remote";
  title: string;
}

/** Local, then remote-only; empty sections dropped. */
export function branchSections(
  branches: readonly RemoteGitBranch[],
): BranchSection[] {
  const sections: BranchSection[] = [
    {
      scope: "local",
      title: "Local",
      branches: branches.filter((b) => b.scope === "local"),
    },
    {
      scope: "remote",
      title: "Remote only",
      branches: branches.filter((b) => b.scope === "remote"),
    },
  ];

  return sections.filter((s) => s.branches.length > 0);
}

export function currentBranchName(
  branches: readonly RemoteGitBranch[],
): string | null {
  return branches.find((b) => b.is_current)?.name ?? null;
}

/**
 * What a new branch may start from: local refs, then remote-only ones. A
 * preselected start point the list doesn't have leads.
 */
export function branchStartPoints(
  branches: readonly RemoteGitBranch[],
  start: string | null,
): string[] {
  const all = [
    ...branches.filter((b) => b.scope === "local").map(branchRef),
    ...branches.filter((b) => b.scope === "remote").map(branchRef),
  ];

  return !start || all.includes(start) ? all : [start, ...all];
}

export type PullStrategy = "ff-only" | "merge" | "rebase";

export const PULL_STRATEGIES: { label: string; value: PullStrategy }[] = [
  { value: "ff-only", label: "Fast-forward" },
  { value: "merge", label: "Merge" },
  { value: "rebase", label: "Rebase" },
];

export type BranchAction =
  | { kind: "checkout" }
  | { kind: "compare" }
  | { kind: "copyName" }
  | { kind: "delete" }
  | { kind: "forcePush" }
  | { kind: "merge"; squash: boolean }
  | { kind: "newBranch" }
  | { kind: "openPullRequest" }
  | { kind: "pin" }
  | { kind: "pull"; strategy: PullStrategy }
  | { kind: "push" }
  | { kind: "rebase" }
  | { kind: "rename" };

export interface BranchMenuItem {
  action: BranchAction;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  /** The pull strategies, for "Pull". */
  children?: BranchMenuItem[];
}

export type BranchMenuGroup =
  | "checkout"
  | "integrate"
  | "manage"
  | "newBranch"
  | "remote";

export interface BranchMenuSection {
  group: BranchMenuGroup;
  items: BranchMenuItem[];
}

export interface BranchMenuOptions {
  /** Offer "Compare with" — the caller can show a comparison. */
  canCompare?: boolean;
  /** The checked-out branch, for the labels; null reads "the current branch". */
  current: string | null;
}

/** Everything a branch offers, in the Mac's branch-menu order. */
export function branchMenu(
  branch: RemoteGitBranch,
  { canCompare = false, current }: BranchMenuOptions,
): BranchMenuSection[] {
  const isLocal = branch.scope === "local";
  const hasUpstream = Boolean(branch.upstream);
  const target = current ?? "the current branch";
  let checkoutLabel = isLocal ? "Switch to" : "Check out locally";
  if (branch.is_current) {
    checkoutLabel = "Checked out";
  }
  const sections: BranchMenuSection[] = [
    {
      group: "checkout",
      items: [
        {
          action: { kind: "checkout" },
          label: checkoutLabel,
          disabled: branch.is_current,
        },
      ],
    },
    {
      group: "newBranch",
      items: [
        {
          action: { kind: "newBranch" },
          label: `New branch from ${branch.name}…`,
        },
      ],
    },
  ];

  if (!branch.is_current) {
    sections.push({
      group: "integrate",
      items: [
        {
          action: { kind: "merge", squash: false },
          label: `Merge into ${target}`,
        },
        {
          action: { kind: "merge", squash: true },
          label: `Squash into ${target}`,
        },
        { action: { kind: "rebase" }, label: `Rebase ${target} onto this` },
        ...(canCompare
          ? [
              {
                action: { kind: "compare" } as const,
                label: `Compare with ${target}`,
              },
            ]
          : []),
      ],
    });
  }

  const remote: BranchMenuItem[] = [];
  if (isLocal) {
    remote.push({
      action: { kind: "push" },
      label: hasUpstream ? "Push" : "Publish",
    });
    if (hasUpstream) {
      remote.push({ action: { kind: "forcePush" }, label: "Force push…" });
    }
  }
  if (branch.is_current && hasUpstream) {
    remote.push({
      action: { kind: "pull", strategy: "ff-only" },
      label: "Pull",
      children: PULL_STRATEGIES.map((s) => ({
        action: { kind: "pull", strategy: s.value },
        label: s.label,
      })),
    });
  }
  if (hasUpstream || branch.scope === "remote") {
    remote.push({
      action: { kind: "openPullRequest" },
      label: "Open pull request",
    });
  }
  if (remote.length > 0) {
    sections.push({ group: "remote", items: remote });
  }

  const manage: BranchMenuItem[] = [];
  if (isLocal) {
    manage.push(
      { action: { kind: "pin" }, label: branch.pinned ? "Unpin" : "Pin" },
      { action: { kind: "rename" }, label: "Rename…" },
    );
  }
  manage.push({ action: { kind: "copyName" }, label: "Copy name" });
  if (isLocal && !branch.is_current) {
    manage.push({ action: { kind: "delete" }, label: "Delete…", danger: true });
  }
  sections.push({ group: "manage", items: manage });

  return sections;
}

/** The confirmations a branch action asks before it runs. */
export type BranchConfirm =
  | { kind: "delete"; unmerged: boolean }
  | { kind: "dirty" }
  | { kind: "forcePush" }
  | { kind: "merge"; squash: boolean }
  | { kind: "rebase" };

export interface BranchPrompt {
  confirmLabel: string;
  destructive: boolean;
  message: string;
  title: string;
}

export function branchPrompt(
  confirm: BranchConfirm,
  branch: string,
  current: string | null,
): BranchPrompt {
  const target = current ?? "the current branch";
  switch (confirm.kind) {
    case "merge":
      return {
        title: confirm.squash
          ? `Squash ${branch} into ${target}?`
          : `Merge ${branch} into ${target}?`,
        message: "If it stops on conflicts, resolve them on the computer.",
        confirmLabel: confirm.squash ? "Squash" : "Merge",
        destructive: false,
      };
    case "rebase":
      return {
        title: `Rebase ${target} onto ${branch}?`,
        message: `This rewrites ${target}'s commits. If it stops on conflicts, resolve them on the computer.`,
        confirmLabel: "Rebase",
        destructive: true,
      };
    case "forcePush":
      return {
        title: `Force push ${branch}?`,
        message:
          "Overwrites the remote branch, unless someone pushed since you last fetched.",
        confirmLabel: "Force push",
        destructive: true,
      };
    case "delete":
      return confirm.unmerged
        ? {
            title: `${branch} isn't fully merged`,
            message:
              "It has commits that aren't on any other branch. Deleting it loses them.",
            confirmLabel: "Delete anyway",
            destructive: true,
          }
        : {
            title: `Delete ${branch}?`,
            message: "This deletes the local branch.",
            confirmLabel: "Delete",
            destructive: true,
          };
    case "dirty":
      return {
        title: "Uncommitted changes",
        message: `Switching to ${branch} would overwrite local changes.`,
        confirmLabel: "Stash & switch",
        destructive: false,
      };
  }
}

/** "Tracks origin/x", "Not published", or nothing for a remote-only branch. */
export function branchTrackingLabel(branch: RemoteGitBranch): string | null {
  if (branch.upstream) {
    return `Tracks ${branch.upstream}`;
  }

  return branch.scope === "local" ? "Not published" : null;
}
