import type { Meta, StoryObj } from "@storybook/react";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PriorityIcon } from "../PriorityIcon/PriorityIcon";
import { PropertyButton } from "./PropertyButton";

const meta: Meta<typeof PropertyButton> = {
  title: "Components/PropertyButton",
  component: PropertyButton,
};

export default meta;

type Story = StoryObj<typeof PropertyButton>;

export const Status: Story = {
  args: { icon: <IssueStatusIcon type="unstarted" />, label: "Todo" },
};

export const Open: Story = {
  args: { icon: <PriorityIcon priority={2} />, label: "High", expanded: true },
};

export const ReadOnly: Story = {
  args: { icon: <PriorityIcon priority={2} />, label: "High", disabled: true },
};
