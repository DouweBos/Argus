import type { Meta, StoryObj } from "@storybook/react";
import { BranchPicker } from "./BranchPicker";

const meta: Meta<typeof BranchPicker> = {
  title: "Git/BranchPicker",
  component: BranchPicker,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof BranchPicker>;

const noop = () => undefined;

const local = [
  {
    id: "local:main",
    name: "main",
    isCurrent: true,
    detail: "fix(image-viewer): improve zoom toolbar",
    ahead: 0,
    behind: 0,
  },
  {
    id: "local:feature/git-client",
    name: "feature/git-client",
    detail: "wire enriched branches IPC",
    ahead: 3,
    behind: 1,
  },
  {
    id: "local:fix/typo",
    name: "fix/typo",
    detail: "tiny copy fix",
    ahead: 1,
    behind: 0,
  },
];

const remote = [
  {
    id: "remote:origin/main",
    name: "origin/main",
    detail: "release 1.4.0",
    remote: "origin",
  },
  {
    id: "remote:origin/feature/git-client",
    name: "origin/feature/git-client",
    detail: "wire enriched branches IPC",
    remote: "origin",
  },
];

export const Default: Story = {
  args: {
    open: true,
    title: "Checkout branch",
    confirmLabel: "Checkout",
    branches: local,
    onSelect: noop,
    onCancel: noop,
  },
};

export const WithRemote: Story = {
  args: {
    open: true,
    title: "Pick branch",
    confirmLabel: "Pull",
    branches: local,
    remoteBranches: remote,
    onSelect: noop,
    onCancel: noop,
  },
};

export const Empty: Story = {
  args: {
    open: true,
    title: "Checkout branch",
    confirmLabel: "Checkout",
    branches: [],
    onSelect: noop,
    onCancel: noop,
  },
};

export const Filtered: Story = {
  args: {
    open: true,
    title: "Checkout branch",
    confirmLabel: "Checkout",
    branches: local,
    remoteBranches: remote,
    defaultFilter: "feature",
    onSelect: noop,
    onCancel: noop,
  },
};

export const LongList: Story = {
  args: {
    open: true,
    title: "Checkout branch",
    confirmLabel: "Checkout",
    branches: Array.from({ length: 60 }, (_, i) => ({
      id: `local:branch-${i}`,
      name: `feature/branch-${i.toString().padStart(2, "0")}`,
      detail: `commit ${i}: tweak something`,
      ahead: i % 5,
      behind: i % 3,
      isCurrent: i === 0,
    })),
    onSelect: noop,
    onCancel: noop,
  },
};
