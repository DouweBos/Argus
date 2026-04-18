import type { Meta, StoryObj } from "@storybook/react";
import { CommitIcon } from "../../icons/HomeIcons";
import {
  ArgusLogo,
  FolderIcon,
  GitChangesIcon,
  HomeIcon,
  MergeIcon,
  PlusIcon,
} from "../../icons/Icons";
import { WorkspaceCard } from "../WorkspaceCard/WorkspaceCard";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarItem,
  SidebarNav,
  SidebarNavGroup,
  SidebarRepoGroup,
  SidebarScroll,
  SidebarSection,
  SidebarWorkspaceRow,
} from "./SidebarNav";

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

export const FramedHome: Story = {
  name: "Framed · Home shell",
  render: () => (
    <div
      style={{ height: 640, display: "flex", background: "var(--bg-primary)" }}
    >
      <SidebarNav framed aria-label="Home sidebar">
        <SidebarHeader
          brand={
            <>
              <ArgusLogo size={16} /> Argus
            </>
          }
          actions={
            <>
              <SidebarHeaderAction title="New workspace">
                <PlusIcon size={12} />
              </SidebarHeaderAction>
              <SidebarHeaderAction title="Open repo">
                <FolderIcon size={12} />
              </SidebarHeaderAction>
            </>
          }
        />
        <SidebarNavGroup>
          <SidebarItem active leading={<HomeIcon size={12} />} count="—">
            Home
          </SidebarItem>
          <SidebarItem leading={<MergeIcon size={12} />} count={4}>
            Review queue
          </SidebarItem>
          <SidebarItem leading={<CommitIcon size={12} />} count="∞">
            Activity
          </SidebarItem>
        </SidebarNavGroup>
        <SidebarScroll>
          <SidebarSection count={3}>Workspaces</SidebarSection>
          <SidebarRepoGroup
            name="argus-core"
            color="#4d9fff"
            count={2}
            leading={<FolderIcon size={11} />}
          >
            <SidebarWorkspaceRow
              active
              name="feat/workspace-card"
              status="success"
              pulse
              added={128}
              removed={47}
            />
            <SidebarWorkspaceRow
              name="fix/diff-hunk-staging"
              status="warning"
            />
          </SidebarRepoGroup>
          <SidebarRepoGroup
            name="peacock"
            color="#7c5cfc"
            count={1}
            leading={<FolderIcon size={11} />}
          >
            <SidebarWorkspaceRow name="chore/tokens-cleanup" status="idle" />
          </SidebarRepoGroup>
          <SidebarSection count={2}>Recent</SidebarSection>
          <SidebarRepoGroup
            name="lavender"
            color="#00d4aa"
            expanded={false}
            dim
            leading={<FolderIcon size={11} />}
          />
          <SidebarRepoGroup
            name="marmalade"
            color="#f5a623"
            expanded={false}
            dim
            leading={<FolderIcon size={11} />}
          />
        </SidebarScroll>
        <SidebarFooter leading={<PlusIcon size={11} />}>
          Add repository
        </SidebarFooter>
      </SidebarNav>
      <div style={{ flex: 1 }} />
    </div>
  ),
};

export const FramedCollapsed: Story = {
  name: "Framed · Collapsed",
  render: () => (
    <div
      style={{ height: 480, display: "flex", background: "var(--bg-primary)" }}
    >
      <SidebarNav framed collapsed aria-label="Home sidebar collapsed">
        <SidebarHeader brand={<ArgusLogo size={20} />} />
      </SidebarNav>
      <div style={{ flex: 1 }} />
    </div>
  ),
};
