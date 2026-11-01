import type { Meta, StoryObj } from "@storybook/react";
import { RunFeedbackDialog } from "./RunFeedbackDialog";

const meta: Meta<typeof RunFeedbackDialog> = {
  title: "Automations/RunFeedbackDialog",
  component: RunFeedbackDialog,
  tags: ["autodocs"],
  args: { onClose: () => undefined },
};
export default meta;
type Story = StoryObj<typeof RunFeedbackDialog>;

export const Default: Story = {
  args: { onSend: () => new Promise((r) => setTimeout(r, 600)) },
};

export const Refused: Story = {
  args: {
    onSend: () =>
      Promise.reject(new Error("The run's session was deleted with it.")),
  },
};
