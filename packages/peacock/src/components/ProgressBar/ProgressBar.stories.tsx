import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar";

const meta: Meta<typeof ProgressBar> = {
  title: "Primitives/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  args: { progress: 0.4, size: "sm" },
  argTypes: {
    progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    size: { control: "select", options: ["xs", "sm", "md"] },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const ExtraSmall: Story = { args: { size: "xs", progress: 0.4 } };
export const Small: Story = { args: { size: "sm", progress: 0.4 } };
export const Medium: Story = { args: { size: "md", progress: 0.7 } };
export const Empty: Story = { args: { progress: 0 } };
export const Full: Story = { args: { progress: 1 } };
export const Indeterminate: Story = { args: { indeterminate: true } };
