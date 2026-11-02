import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  GitChangesIcon,
  HomeIcon,
  InboxIcon,
  LeftSidebarIcon,
  RightSidebarIcon,
  SimulatorIcon,
  TerminalIcon,
} from "../../icons/Icons";
import { AgentTabStrip } from "../AgentTabStrip/AgentTabStrip";
import {
  AppSidebar,
  AppSidebarGroup,
  AppSidebarNavItem,
  SidebarSearchField,
} from "../AppSidebar/AppSidebar";
import {
  AppSidebarProjectHeader,
  AppSidebarSessionRow,
} from "../AppSidebar/AppSidebarRows";
import { AppBreadcrumb, AppToolbar } from "../AppToolbar/AppToolbar";
import { EmptyState } from "../EmptyState/EmptyState";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import { SidePanel } from "../SidePanel/SidePanel";
import { AppShell, type ShellMode } from "./AppShell";

const meta: Meta<typeof AppShell> = {
  title: "Layouts/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof AppShell>;

function Window({
  mode,
  panel: startPanel,
}: {
  mode: ShellMode;
  panel: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(mode === "docked");
  const [panel, setPanel] = useState(startPanel);
  const [query, setQuery] = useState("");

  return (
    <div style={{ height: "100vh" }}>
      <AppShell
        panel={
          panel ? (
            <SidePanel
              selectedId="device"
              tabs={[
                {
                  id: "device",
                  title: "Device",
                  icon: <SimulatorIcon size={13} />,
                },
                {
                  id: "terminal",
                  title: "Terminal",
                  icon: <TerminalIcon size={13} />,
                },
                {
                  id: "changes",
                  title: "Changes",
                  icon: <GitChangesIcon size={13} />,
                },
              ]}
              onClose={() => setPanel(false)}
              onSelect={() => {}}
            >
              <EmptyState
                title="No device"
                body="Boot a simulator to see it here."
              />
            </SidePanel>
          ) : null
        }
        panelMode={mode}
        sidebar={
          <AppSidebar
            top={<SidebarSearchField value={query} onChange={setQuery} />}
            nav={
              <>
                <AppSidebarNavItem icon={<HomeIcon size={14} />} label="Home" />
                <AppSidebarNavItem
                  count={1}
                  icon={<InboxIcon size={15} />}
                  label="Inbox"
                />
              </>
            }
          >
            <AppSidebarGroup>
              <AppSidebarProjectHeader
                branch="main"
                name="argus-web"
                projectKey="/src/argus-web"
              />
              <AppSidebarSessionRow
                selected
                busy
                age="now"
                status="accent"
                title="Restyle the web client"
              />
            </AppSidebarGroup>
          </AppSidebar>
        }
        sidebarMode={mode}
        sidebarOpen={sidebarOpen}
        toolbar={
          <AppToolbar
            leading={
              !sidebarOpen || mode === "overlay" ? (
                <FlatIconButton
                  icon={<LeftSidebarIcon size={15} />}
                  label="Show sidebar"
                  onClick={() => setSidebarOpen(true)}
                />
              ) : undefined
            }
            title={
              <AppBreadcrumb
                steps={[
                  {
                    label: "argus-web",
                    project: { name: "argus-web", key: "/src/argus-web" },
                  },
                  { label: "Restyle the web client" },
                ]}
              />
            }
            trailing={
              <FlatIconButton
                icon={<RightSidebarIcon size={15} />}
                label="Side panel"
                selected={panel}
                onClick={() => setPanel((p) => !p)}
              />
            }
            onBack={() => {}}
            onForward={() => {}}
          />
        }
        onPanelDismiss={() => setPanel(false)}
        onSidebarDismiss={() => setSidebarOpen(false)}
      >
        <AgentTabStrip
          selectedId="a"
          tabs={[{ id: "a", title: "New agent", status: "accent", busy: true }]}
          onNew={() => {}}
          onSelect={() => {}}
        />
        <EmptyState
          title="Transcript"
          body="The agent's chat fills the centre."
        />
      </AppShell>
    </div>
  );
}

export const Desktop: Story = { render: () => <Window mode="docked" panel /> };

export const NoPanel: Story = {
  render: () => <Window mode="docked" panel={false} />,
};

/** Narrow windows: the sidebar is a drawer, the panel a sheet. */
export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => <Window mode="overlay" panel={false} />,
};
