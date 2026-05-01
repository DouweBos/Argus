import type { Meta, StoryObj } from "@storybook/react";
import { GitSkeleton } from "./GitSkeleton";

const meta: Meta<typeof GitSkeleton> = {
  title: "Git/GitSkeleton",
  component: GitSkeleton,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof GitSkeleton>;

export const FileList: Story = { args: { variant: "file-list" } };
export const CommitLog: Story = { args: { variant: "commit-log" } };
export const Diff: Story = { args: { variant: "diff" } };
export const StashList: Story = { args: { variant: "stash-list" } };
export const BranchList: Story = { args: { variant: "branch-list" } };
