import type { Meta, StoryObj } from "@storybook/react";
import { RebaseEditor } from "./RebaseEditor";

const meta: Meta<typeof RebaseEditor> = {
  title: "Git/RebaseEditor",
  component: RebaseEditor,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof RebaseEditor>;

const noop = () => undefined;

const COMMITS = [
  {
    hash: "a1b2c3d4e5f6",
    subject: "feat: add bisect view",
    author: "Douwe Bos",
  },
  {
    hash: "b2c3d4e5f6a1",
    subject: "fix: handle empty rebase plan",
    author: "Douwe Bos",
  },
  {
    hash: "c3d4e5f6a1b2",
    subject: "refactor: split history filters",
    author: "Douwe Bos",
  },
  {
    hash: "d4e5f6a1b2c3",
    subject: "test: integration coverage for cherry-pick",
    author: "Douwe Bos",
  },
];

export const Default: Story = {
  args: {
    open: true,
    baseRef: "main",
    commits: COMMITS,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Reorder: Story = {
  args: {
    open: true,
    baseRef: "main",
    commits: COMMITS.slice(0, 3),
    onConfirm: noop,
    onCancel: noop,
  },
};

export const WithSquash: Story = {
  args: {
    open: true,
    baseRef: "main",
    commits: COMMITS,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const WithReword: Story = {
  args: {
    open: true,
    baseRef: "main",
    commits: COMMITS,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Empty: Story = {
  args: {
    open: true,
    baseRef: "main",
    commits: [],
    onConfirm: noop,
    onCancel: noop,
  },
};

export const ConflictPause: Story = {
  args: {
    open: true,
    baseRef: "main",
    commits: COMMITS,
    pausedAt: COMMITS[1]?.hash,
    onConfirm: noop,
    onCancel: noop,
    onAbort: noop,
    onContinue: noop,
  },
};
