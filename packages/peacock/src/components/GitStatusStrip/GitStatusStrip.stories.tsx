import type { Meta, StoryObj } from "@storybook/react";
import { GitStatusStrip } from "./GitStatusStrip";

const meta: Meta<typeof GitStatusStrip> = {
  title: "Git/GitStatusStrip",
  component: GitStatusStrip,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof GitStatusStrip>;

const base = {
  branch: "feature/agent-git-overhaul",
  upstream: "origin/feature/agent-git-overhaul",
  ahead: 0,
  behind: 0,
  dirtyCount: 0,
  stashCount: 0,
  conflictCount: 0,
  inProgress: null,
  detached: false,
  lastFetchAt: Date.now() - 2 * 60_000,
};

export const Idle: Story = { args: { ...base } };

export const Dirty: Story = { args: { ...base, dirtyCount: 7 } };

export const AheadBehind: Story = {
  args: { ...base, ahead: 3, behind: 2, dirtyCount: 1 },
};

export const NoUpstream: Story = {
  args: { ...base, upstream: null, lastFetchAt: null },
};

export const Detached: Story = {
  args: { ...base, branch: "a1b2c3d", detached: true, upstream: null },
};

export const MergeInProgress: Story = {
  args: {
    ...base,
    conflictCount: 3,
    inProgress: { kind: "merge", head: "feature-x", onto: "main" },
  },
};

export const RebaseInProgress: Story = {
  args: {
    ...base,
    conflictCount: 1,
    inProgress: {
      kind: "rebase",
      head: "feature-x",
      onto: "main",
      progress: "3/12",
    },
  },
};

export const CherryPickInProgress: Story = {
  args: {
    ...base,
    conflictCount: 1,
    inProgress: { kind: "cherry-pick", head: "feature-x" },
  },
};

export const WithStashes: Story = {
  args: { ...base, stashCount: 4, dirtyCount: 2 },
};

export const WithConflicts: Story = {
  args: { ...base, conflictCount: 5, dirtyCount: 5 },
};

export const NeverFetched: Story = {
  args: { ...base, lastFetchAt: null, upstream: null },
};

export const FullStatus: Story = {
  name: "Full · Ahead + dirty + stash",
  args: {
    ...base,
    branch: "feat/git-polish",
    upstream: "origin/feat/git-polish",
    ahead: 2,
    behind: 1,
    dirtyCount: 5,
    stashCount: 2,
    lastFetchAt: Date.now() - 8 * 60_000,
  },
};
