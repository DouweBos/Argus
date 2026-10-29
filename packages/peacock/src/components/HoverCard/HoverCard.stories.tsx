import type { Meta, StoryObj } from "@storybook/react";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PropertyButton } from "../PropertyButton/PropertyButton";
import { HoverCard } from "./HoverCard";

const meta: Meta<typeof HoverCard> = {
  title: "Components/HoverCard",
  component: HoverCard,
  decorators: [
    (Story) => <div style={{ padding: "40px 40px 40px 300px" }}>{Story()}</div>,
  ],
};

export default meta;

type Story = StoryObj<typeof HoverCard>;

export const TimeInStatus: Story = {
  args: {
    delay: 0,
    card: (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <strong>Time in status</strong>
        <span>Triage · 5d</span>
        <span>Todo · 10mo</span>
      </div>
    ),
    children: (
      <PropertyButton
        icon={<IssueStatusIcon type="unstarted" />}
        label="Todo"
      />
    ),
  },
};
