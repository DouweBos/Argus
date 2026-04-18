import type { Meta, StoryObj } from "@storybook/react";
import { ProjectCard } from "./ProjectCard";

const meta: Meta<typeof ProjectCard> = {
  title: "Composites/ProjectCard",
  component: ProjectCard,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ProjectCard>;

export const Running: Story = {
  args: {
    name: "Argus",
    path: "~/Code/argus",
    platform: "desktop",
    accent: "#4d9fff",
    starred: true,
    agents: [
      { status: "running" },
      { status: "pending" },
      { status: "running" },
    ],
    lastOpened: "2m ago",
  },
  render: (args) => (
    <div style={{ width: 340 }}>
      <ProjectCard {...args} />
    </div>
  ),
};

export const ErrorState: Story = {
  args: {
    name: "linear-web",
    path: "~/Code/linear-web",
    platform: "web",
    accent: "#00d4aa",
    starred: true,
    agents: [{ status: "error" }],
    lastOpened: "1h ago",
  },
  render: (args) => (
    <div style={{ width: 340 }}>
      <ProjectCard {...args} />
    </div>
  ),
};

export const NoAgents: Story = {
  args: {
    name: "paperlane",
    path: "~/Code/paperlane",
    platform: "desktop",
    accent: "#f5a623",
    agents: [],
    lastOpened: "3h ago",
  },
  render: (args) => (
    <div style={{ width: 340 }}>
      <ProjectCard {...args} />
    </div>
  ),
};
