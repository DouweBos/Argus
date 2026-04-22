import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TaskIcon } from "../../icons/Icons";
import { ProjectCard } from "../ProjectCard/ProjectCard";
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
    name: "Plex",
    description: "Plex platform repos",
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

export const WithRunningTasks: Story = {
  args: {
    name: "Houwert.dev",
    description: "Argus + Conductor ship as one product",
    accent: "#7c5cff",
    members: ["argus", "conductor"],
    taskCount: 2,
    runningCount: 2,
  },
  render: (args) => {
    function Demo() {
      const [expanded, setExpanded] = useState(true);

      return (
        <div style={{ width: 340 }}>
          <OrganizationCard
            {...args}
            collapsible
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
            toggleLabel="2 running tasks"
          >
            <ProjectCard
              name="Ship onboarding redesign"
              accent={args.accent}
              icon={<TaskIcon size={14} />}
              agents={[{ status: "running" }, { status: "running" }]}
              lastOpened="3m ago"
            />
            <ProjectCard
              name="Wire analytics events"
              accent={args.accent}
              icon={<TaskIcon size={14} />}
              agents={[{ status: "running" }]}
              lastOpened="12m ago"
            />
          </OrganizationCard>
        </div>
      );
    }

    return <Demo />;
  },
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
