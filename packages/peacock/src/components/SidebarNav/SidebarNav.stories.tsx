import type { Meta, StoryObj } from "@storybook/react";
import { CommitIcon } from "../../icons/HomeIcons";
import {
  ArgusLogo,
  BranchIcon,
  ClockIcon,
  FolderIcon,
  HistoryIcon,
  HomeIcon,
  PlusIcon,
  StashIcon,
  WorkingCopyIcon,
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
      <SidebarSection count={5}>Sessions</SidebarSection>
      <SessionCard
        icon={<BranchIcon size={13} />}
        title="feat/session-card"
        interactive
        selected
        diff={{ added: 128, removed: 47 }}
      />
      <SessionCard
        icon={<BranchIcon size={13} />}
        title="fix/diff-hunk-staging"
        interactive
        status={{ label: "initializing", tone: "warning" }}
      />
    </SidebarNav>
  ),
};

export const Attention: Story = {
  name: "Item · unread dot",
  render: () => (
    <SidebarNav style={{ width: 240 }}>
      <SidebarItem leading={<HomeIcon size={12} />} count="—">
        Home
      </SidebarItem>
      <SidebarItem attention leading={<CommitIcon size={12} />} count={3}>
        Automations
      </SidebarItem>
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
            <SidebarSessionRow name="fix/diff-hunk-staging" status="warning" />
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

export const SectionWithAction: Story = {
  name: "Framed · Section with action",
  render: () => (
    <div
      style={{ height: 240, display: "flex", background: "var(--bg-primary)" }}
    >
      <SidebarNav framed aria-label="Section with action">
        <SidebarScroll>
          <SidebarSection
            count={2}
            action={
              <SidebarRepoAction title="New scratch pad">
                <PlusIcon size={10} />
              </SidebarRepoAction>
            }
          >
            Scratch pads
          </SidebarSection>
        </SidebarScroll>
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

export const GitSourceSidebar: Story = {
  name: "Git · Source sidebar",
  render: () => (
    <div
      style={{ height: 480, display: "flex", background: "var(--bg-primary)" }}
    >
      <SidebarNav
        framed
        style={{ width: 180, minWidth: 180 }}
        aria-label="Git source sidebar"
      >
        <SidebarSection>Workspace</SidebarSection>
        <SidebarItem active leading={<WorkingCopyIcon size={13} />} count={3}>
          Working Copy
        </SidebarItem>
        <SidebarItem leading={<ClockIcon size={13} />}>History</SidebarItem>
        <SidebarItem leading={<StashIcon size={13} />} count={1}>
          Stashes
        </SidebarItem>
        <SidebarItem leading={<HistoryIcon size={13} />}>Reflog</SidebarItem>
        <SidebarSection>Project</SidebarSection>
        <SidebarItem leading={<BranchIcon size={13} />}>Branches</SidebarItem>
        <SidebarItem leading={<FolderIcon size={13} />}>Worktrees</SidebarItem>
      </SidebarNav>
      <div style={{ flex: 1 }} />
    </div>
  ),
};
