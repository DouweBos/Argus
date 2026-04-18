import type { Meta, StoryObj } from "@storybook/react";
import { Planet } from "./Planet";

const meta: Meta<typeof Planet> = {
  title: "Composites/Planet",
  component: Planet,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Planet>;

export const Live: Story = {
  args: {
    name: "Argus",
    branch: "main",
    platform: "desktop",
    when: "2m ago",
    accent: "#4d9fff",
    agents: [
      {
        id: "a1",
        name: "feat/workspace-card",
        status: "running",
        tool: "running",
      },
      {
        id: "a2",
        name: "fix/diff-hunk-staging",
        status: "pending",
        tool: "perm",
      },
      {
        id: "a3",
        name: "refactor/ipc-types",
        status: "running",
        tool: "running",
      },
    ],
    diff: { add: 128, del: 47, files: 12 },
  },
};

export const Clean: Story = {
  args: {
    name: "paperlane",
    branch: "main",
    platform: "desktop",
    when: "3h ago",
    accent: "#f5a623",
    agents: [],
    emptyLabel: "no agents · last commit 3h ago",
    diff: { add: 0, del: 0, files: 0 },
  },
};
