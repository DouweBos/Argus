import type { Meta, StoryObj } from "@storybook/react";
import { BranchCompare, type BranchCompareResult } from "./BranchCompare";

const meta: Meta<typeof BranchCompare> = {
  title: "Components/BranchCompare",
  component: BranchCompare,
  parameters: { layout: "fullscreen" },
  args: {
    left: "main",
    right: "feature/land-work",
    formatAge: () => "2d ago",
  },
};
export default meta;
type Story = StoryObj<typeof BranchCompare>;

const commit = (hash: string, subject: string) => ({
  hash,
  subject,
  author: "Douwe Bos",
  timestamp: 0,
});

const DIVERGED: BranchCompareResult = {
  mergeBase: "8aead07a1c2d3e4f",
  wouldConflict: false,
  leftOnly: [commit("a1b2c3d4", "fix(agents): end a limit stall")],
  rightOnly: [
    commit("e5f6a7b8", "feat(web): land work card"),
    commit("c9d0e1f2", "feat(web): branches screen"),
  ],
};

export const Diverged: Story = {
  args: { result: DIVERGED, onOpenCommit: () => {} },
};

export const ConflictsLikely: Story = {
  args: { result: { ...DIVERGED, wouldConflict: true } },
};

export const NoCommonHistory: Story = {
  args: {
    result: {
      mergeBase: null,
      wouldConflict: false,
      leftOnly: [],
      rightOnly: [],
    },
  },
};

export const Loading: Story = { args: { result: null, loading: true } };

export const Failed: Story = {
  args: { result: null, error: "fatal: bad revision 'nope'" },
};
