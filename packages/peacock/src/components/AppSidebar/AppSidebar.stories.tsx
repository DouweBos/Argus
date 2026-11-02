import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ReactNode } from "react";
import {
  AgentIcon,
  BellIcon,
  ClockIcon,
  ComposeIcon,
  FilterIcon,
  FolderPlusIcon,
  GaugeIcon,
  GearIcon,
  HomeIcon,
  InboxIcon,
  LinearIcon,
  PlusIcon,
  PullRequestIcon,
  SimulatorIcon,
} from "../../icons/Icons";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import {
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarNavItem,
  AppSidebarSectionRule,
  SidebarSearchField,
} from "./AppSidebar";
import {
  AppSidebarProjectHeader,
  AppSidebarSessionRow,
} from "./AppSidebarRows";

const meta: Meta<typeof AppSidebar> = {
  title: "Composites/AppSidebar",
  component: AppSidebar,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof AppSidebar>;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 272,
        height: 640,
        background: "var(--chrome-sidebar)",
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
      }}
    >
      {children}
    </div>
  );
}

const NAV = [
  { label: "Home", icon: <HomeIcon size={14} /> },
  { label: "Inbox", icon: <InboxIcon size={15} />, count: 2 },
  { label: "Agents", icon: <AgentIcon size={14} /> },
  { label: "Devices", icon: <SimulatorIcon size={14} /> },
  { label: "Automations", icon: <ClockIcon size={14} /> },
  { label: "Issues", icon: <LinearIcon size={14} /> },
];

function Sidebar({ withSessions = true }: { withSessions?: boolean }) {
  const [query, setQuery] = useState("");
  const [screen, setScreen] = useState("Home");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AppSidebar
      top={
        <>
          <SidebarSearchField value={query} onChange={setQuery} />
          <FlatIconButton
            icon={<FilterIcon size={13} />}
            label="Filter by project"
          />
          <FlatIconButton
            icon={<FolderPlusIcon size={15} />}
            label="Add project"
          />
          <FlatIconButton
            icon={<ComposeIcon size={14} />}
            label="New session"
          />
        </>
      }
      nav={NAV.map((item) => (
        <AppSidebarNavItem
          key={item.label}
          count={item.count}
          icon={item.icon}
          label={item.label}
          selected={screen === item.label}
          onClick={() => setScreen(item.label)}
        />
      ))}
      footer={
        <AppSidebarFooter
          leading={
            <>
              <FlatIconButton
                icon={<GearIcon size={15} />}
                label="Settings"
                size="lg"
              />
              <FlatIconButton
                icon={<PullRequestIcon size={15} />}
                label="Pull requests"
                size="lg"
              />
              <FlatIconButton
                icon={<GaugeIcon size={15} />}
                label="Usage"
                size="lg"
              />
            </>
          }
          trailing={
            <FlatIconButton
              badge={3}
              icon={<BellIcon size={15} />}
              label="Notifications"
              size="lg"
            />
          }
        />
      }
    >
      <AppSidebarGroup>
        <AppSidebarProjectHeader
          ahead={2}
          behind={1}
          branch="main"
          collapsed={withSessions ? collapsed : null}
          name="argus-web"
          projectKey="/src/argus-web"
          selected={screen === "argus-web"}
          onClick={() => setScreen("argus-web")}
          onNewSession={() => {}}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
        {withSessions && !collapsed && (
          <>
            <AppSidebarSessionRow
              busy
              age="now"
              selected={screen === "s1"}
              status="accent"
              title="Restyle the web client"
              onClick={() => setScreen("s1")}
            />
            <AppSidebarSessionRow
              age="2h"
              note="Waiting"
              status="warning"
              title="Fix the connection badge"
              onClick={() => setScreen("s2")}
            />
            <AppSidebarSessionRow age="3d" title="Settings cleanup" />
            <AppSidebarSessionRow
              unavailable
              age="1w"
              title="On a missing drive"
            />
          </>
        )}
      </AppSidebarGroup>
      <AppSidebarGroup>
        <AppSidebarProjectHeader
          busy
          branch="feature/very-long-branch-name"
          name="Media Server"
          projectKey="/src/pms"
          status="accent"
        />
      </AppSidebarGroup>
      <AppSidebarSectionRule
        action={
          <FlatIconButton
            icon={<PlusIcon size={11} />}
            label="New scratch pad"
            size="sm"
          />
        }
        label="Scratch pads"
      />
    </AppSidebar>
  );
}

export const Default: Story = {
  render: () => (
    <Frame>
      <Sidebar />
    </Frame>
  ),
};

export const ProjectsOnly: Story = {
  render: () => (
    <Frame>
      <Sidebar withSessions={false} />
    </Frame>
  ),
};
