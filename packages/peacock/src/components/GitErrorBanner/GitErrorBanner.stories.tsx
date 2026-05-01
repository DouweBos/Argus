import type { Meta, StoryObj } from "@storybook/react";
import { GitErrorBanner } from "./GitErrorBanner";

const meta: Meta<typeof GitErrorBanner> = {
  title: "Git/GitErrorBanner",
  component: GitErrorBanner,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof GitErrorBanner>;

export const NoUpstream: Story = {
  args: {
    kind: "no-upstream",
    message: "Branch has no upstream configured.",
    recovery: "Publish to origin to enable push and pull.",
  },
};

export const NonFastForward: Story = {
  args: {
    kind: "non-fast-forward",
    message: "Push rejected: non-fast-forward.",
    recovery: "Remote has commits you don't have. Pull then push, or force.",
  },
};

export const AuthRequired: Story = {
  args: {
    kind: "auth-required",
    message: "Authentication failed.",
    recovery: "Credentials are missing or expired.",
  },
};

export const MergeConflict: Story = {
  args: {
    kind: "merge-conflict",
    message: "Merge stopped — 3 files have conflicts.",
    recovery: "Resolve conflicts in the Conflicts view, then continue.",
  },
};

export const RebaseConflict: Story = {
  args: {
    kind: "rebase-conflict",
    message: "Rebase paused — conflicts on commit 3 of 12.",
  },
};

export const CherryPickConflict: Story = {
  args: {
    kind: "cherry-pick-conflict",
    message: "Cherry-pick paused — conflicts in 1 file.",
  },
};

export const DirtyWorkingTree: Story = {
  args: {
    kind: "dirty-working-tree",
    message: "Working tree has uncommitted changes.",
    recovery: "Stash or commit before pulling.",
  },
};

export const DetachedHead: Story = {
  args: {
    kind: "detached-head",
    message: "HEAD is detached at a1b2c3d.",
    recovery: "Create a branch here to keep your work.",
  },
};

export const NothingToCommit: Story = {
  args: { kind: "nothing-to-commit", message: "Nothing to commit." },
};

export const NothingToPush: Story = {
  args: { kind: "nothing-to-push", message: "Everything up-to-date." },
};

export const NothingToPull: Story = {
  args: { kind: "nothing-to-pull", message: "Already up-to-date." },
};

export const LockFileExists: Story = {
  args: {
    kind: "lock-file-exists",
    message: "`.git/index.lock` exists — another git process may be running.",
  },
};

export const LfsMissing: Story = {
  args: {
    kind: "lfs-missing",
    message: "git-lfs is not installed; LFS files are pointers only.",
  },
};

export const HookFailed: Story = {
  args: {
    kind: "hook-failed",
    message: "pre-commit hook failed.",
    recovery: "Hook output:\n  eslint: 3 errors",
  },
};

export const NetworkTimeout: Story = {
  args: {
    kind: "network-timeout",
    message: "Connection to origin timed out.",
  },
};

export const Unknown: Story = {
  args: {
    kind: "unknown",
    message: "git failed with exit code 128.",
    recovery: "fatal: ambiguous argument 'main'",
  },
};

export const Dismissible: Story = {
  args: {
    kind: "no-upstream",
    message: "Branch has no upstream configured.",
    onDismiss: () => undefined,
  },
};

export const WithCopyStderr: Story = {
  args: {
    kind: "unknown",
    message: "git rebase failed.",
    recovery: "fatal: could not apply abc1234... refactor",
  },
};

export const BusyTransient: Story = {
  args: {
    kind: "busy",
    message: "Another git op is running, retrying…",
    variant: "transient",
  },
};
