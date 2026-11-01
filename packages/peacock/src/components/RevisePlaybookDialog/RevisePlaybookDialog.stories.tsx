import type { Meta, StoryObj } from "@storybook/react";
import { RevisePlaybookDialog } from "./RevisePlaybookDialog";

const meta: Meta<typeof RevisePlaybookDialog> = {
  title: "Automations/RevisePlaybookDialog",
  component: RevisePlaybookDialog,
  tags: ["autodocs"],
  args: { onApply: () => undefined, onClose: () => undefined },
};
export default meta;
type Story = StoryObj<typeof RevisePlaybookDialog>;

export const Default: Story = {
  args: {
    onRevise: (instruction) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve(`# Morning triage\n\n${instruction}\n\nThen propose.`),
          600,
        ),
      ),
  },
};

export const Failed: Story = {
  args: {
    onRevise: () => Promise.reject(new Error("Claude is rate limited.")),
  },
};
