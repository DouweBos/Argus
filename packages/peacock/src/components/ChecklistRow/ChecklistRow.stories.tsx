import type { Meta, StoryObj } from "@storybook/react";
import { ChecklistRow } from "./ChecklistRow";

const meta: Meta<typeof ChecklistRow> = {
  title: "Primitives/ChecklistRow",
  component: ChecklistRow,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ChecklistRow>;

export const Passing: Story = {
  args: {
    title: "Claude Code CLI",
    message: "/usr/local/bin/claude",
    tone: "pass",
  },
};

export const Failing: Story = {
  args: {
    title: "Git identity",
    message: "user.name / user.email are not configured",
    tone: "fail",
    detail: "Argus uses this identity for commits inside worktrees.",
  },
};
