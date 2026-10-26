import type { Meta, StoryObj } from "@storybook/react";
import { StackedBar } from "./StackedBar";

const meta: Meta<typeof StackedBar> = {
  title: "Data/StackedBar",
  component: StackedBar,
  tags: ["autodocs"],
  render: (args) => (
    <div style={{ width: 620 }}>
      <StackedBar {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof StackedBar>;

export const CostByType: Story = {
  args: {
    caption: "Cost by type",
    segments: [
      { label: "Input", value: 12.4, display: "$12.40", detail: "0.4%" },
      {
        label: "Cache read",
        value: 1890.2,
        display: "$1,890.20",
        detail: "67.8%",
      },
      {
        label: "Cache write",
        value: 610.9,
        display: "$610.90",
        detail: "21.9%",
      },
      { label: "Output", value: 276.3, display: "$276.30", detail: "9.9%" },
    ],
  },
};

export const TwoParts: Story = {
  args: {
    caption: "Reviewed",
    segments: [
      { label: "Approved", value: 18 },
      { label: "Changes requested", value: 5 },
    ],
  },
};

export const Empty: Story = {
  args: {
    caption: "Tokens by type",
    segments: [
      { label: "Input", value: 0, display: "0" },
      { label: "Output", value: 0, display: "0" },
    ],
  },
};
