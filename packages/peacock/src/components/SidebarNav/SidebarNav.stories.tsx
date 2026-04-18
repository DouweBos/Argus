import type { Meta, StoryObj } from "@storybook/react";
import { SidebarNav, SidebarItem, SidebarSection } from "./SidebarNav";
import { HomeIcon, GitChangesIcon } from "../../icons/Icons";
import { WorkspaceCard } from "../WorkspaceCard/WorkspaceCard";

const meta: Meta<typeof SidebarNav> = {
  title: "Composites/SidebarNav",
  component: SidebarNav,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof SidebarNav>;

export const Default: Story = {
  render: () => (
    <SidebarNav style={{ width: 240 }}>
      <SidebarItem active leading={<HomeIcon size={12} />} count="—">
        Home
      </SidebarItem>
      <SidebarItem leading={<GitChangesIcon size={12} />} count={4}>
        Review queue
      </SidebarItem>
      <SidebarSection count={5}>Workspaces</SidebarSection>
      <WorkspaceCard
        branch="feat/workspace-card"
        selected
        added={128}
        removed={47}
      />
      <WorkspaceCard branch="fix/diff-hunk-staging" status="warning" />
    </SidebarNav>
  ),
};
