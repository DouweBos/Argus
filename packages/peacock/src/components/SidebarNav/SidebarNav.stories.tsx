import type { Meta, StoryObj } from "@storybook/react";
import { CommitIcon } from "../../icons/HomeIcons";
import {
  ArgusLogo,
  FolderIcon,
  HomeIcon,
  PlusIcon,
  ReviewQueueIcon,
} from "../../icons/Icons";
import { SessionCard } from "../SessionCard/SessionCard";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarItem,
  SidebarNav,
  SidebarNavGroup,
  SidebarRepoAction,
  SidebarRepoGroup,
  SidebarScroll,
  SidebarSection,
  SidebarSessionRow,
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
      <SidebarItem leading={<ReviewQueueIcon size={12} />} count={4}>
        Review queue
      </SidebarItem>
      <SidebarSection count={5}>Sessions</SidebarSection>
      <SessionCard
        branch="feat/session-card"
        selected
        added={128}
        removed={47}
      />
      <SessionCard branch="fix/diff-hunk-staging" status="warning" />
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
              <SidebarHeaderAction title="New session">
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
          <SidebarItem leading={<ReviewQueueIcon size={12} />} count={4}>
            Review queue
          </SidebarItem>
          <SidebarItem leading={<CommitIcon size={12} />} count="∞">
            Activity
          </SidebarItem>
        </SidebarNavGroup>
        <SidebarScroll>
          <SidebarSection count={3}>Sessions</SidebarSection>
          <SidebarRepoGroup
            name="argus-core"
            color="#4d9fff"
            count={2}
            active
            leading={<FolderIcon size={11} />}
            actions={
              <>
                <SidebarRepoAction title="New session">
                  <PlusIcon size={10} />
                </SidebarRepoAction>
              </>
            }
          >
            <SidebarSessionRow
              active
              name="feat/session-card"
              status="success"
              pulse
              added={128}
              removed={47}
            />
            <SidebarSessionRow
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
            <SidebarSessionRow name="chore/tokens-cleanup" status="idle" />
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

export const FramedRepoAsHeader: Story = {
  name: "Framed · Repo as unified header",
  render: () => (
    <div
      style={{ height: 480, display: "flex", background: "var(--bg-primary)" }}
    >
      <SidebarNav framed aria-label="Unified repo header">
        <SidebarScroll>
          <SidebarSection count={1}>Sessions</SidebarSection>
          <SidebarRepoGroup
            name="argus"
            active
            leading={<FolderIcon size={11} />}
            meta={
              <>
                <span style={{ color: "var(--text-muted)" }}>123f</span>
                <span style={{ color: "var(--success)" }}>+2771</span>
                <span style={{ color: "var(--error)" }}>-1344</span>
              </>
            }
            subtitle="douwe/peacock-implemenation"
            endContent={
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--success)",
                }}
              />
            }
            actions={
              <>
                <SidebarRepoAction title="New session">
                  <PlusIcon size={10} />
                </SidebarRepoAction>
              </>
            }
            persistentAction={
              <SidebarRepoAction title="Project options">…</SidebarRepoAction>
            }
          >
            <SidebarSessionRow
              name="feat/session-card"
              status="success"
              pulse
              added={128}
              removed={47}
            />
          </SidebarRepoGroup>
        </SidebarScroll>
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
