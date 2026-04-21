import type { Meta, StoryObj } from "@storybook/react";
import { OrganizationCard } from "./OrganizationCard";

const meta: Meta<typeof OrganizationCard> = {
  title: "Composites/OrganizationCard",
  component: OrganizationCard,
  tags: ["autodocs"],
};
export default meta;

type Story = StoryObj<typeof OrganizationCard>;

export const Active: Story = {
  args: {
    name: "Houwert.dev",
    description: "Argus + Conductor ship as one product",
    accent: "#7c5cff",
    members: ["argus", "conductor"],
    taskCount: 3,
    runningCount: 1,
  },
  render: (args) => (
    <div style={{ width: 320 }}>
      <OrganizationCard {...args} />
    </div>
  ),
};

export const Idle: Story = {
  args: {
    name: "Acme",
    description: "Acme platform repos",
    accent: "#f5a623",
    members: ["react-native-client", "luma"],
    taskCount: 1,
    runningCount: 0,
  },
  render: (args) => (
    <div style={{ width: 320 }}>
      <OrganizationCard {...args} />
    </div>
  ),
};

export const Empty: Story = {
  args: {
    name: "New organization",
    accent: "#00d4aa",
    members: [],
    taskCount: 0,
  },
  render: (args) => (
    <div style={{ width: 320 }}>
      <OrganizationCard {...args} />
    </div>
  ),
};
