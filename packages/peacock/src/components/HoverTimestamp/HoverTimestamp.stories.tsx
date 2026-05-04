import type { Meta, StoryObj } from "@storybook/react";
import { HoverTimestamp } from "./HoverTimestamp";

const meta: Meta<typeof HoverTimestamp> = {
  title: "Primitives/HoverTimestamp",
  component: HoverTimestamp,
  tags: ["autodocs"],
};
export default meta;

type Story = StoryObj<typeof HoverTimestamp>;

const now = Date.now();
const placardStyle = {
  padding: 24,
  background: "var(--surface-2)",
  border: "1px solid var(--surface-3)",
  borderRadius: 8,
  color: "var(--text-primary)",
};

export const Single: Story = {
  render: () => (
    <HoverTimestamp timestamp={now}>
      <div style={placardStyle}>Hover me to reveal the timestamp</div>
    </HoverTimestamp>
  ),
};

export const Range: Story = {
  render: () => (
    <HoverTimestamp timestamp={now - 5 * 60 * 1000} endTimestamp={now}>
      <div style={placardStyle}>Hover me — range spans 5 minutes</div>
    </HoverTimestamp>
  ),
};
