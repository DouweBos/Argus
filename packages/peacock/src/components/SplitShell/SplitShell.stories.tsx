import type { Meta, StoryObj } from "@storybook/react";
import {
  SidebarHeader,
  SidebarItem,
  SidebarSection,
} from "../SidebarNav/SidebarNav";
import { SplitShell } from "./SplitShell";

const meta: Meta<typeof SplitShell> = {
  title: "Components/SplitShell",
  component: SplitShell,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof SplitShell>;

function Sidebar() {
  return (
    <>
      <SidebarHeader brand="Workspace" />
      <SidebarSection count={3}>Sessions</SidebarSection>
      <SidebarItem active>Fix the login flow</SidebarItem>
      <SidebarItem>Tidy the settings screen</SidebarItem>
      <SidebarItem>Bump the SDK</SidebarItem>
    </>
  );
}

function Detail({ label }: { label: string }) {
  return (
    <div style={{ padding: 24, color: "var(--text-primary)", fontSize: 13 }}>
      {label}
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <div style={{ height: "100vh" }}>
      <SplitShell sidebar={<Sidebar />}>
        <Detail label="Drag the divider on the sidebar's right edge — mouse, finger or pencil." />
      </SplitShell>
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ height: "100vh" }}>
      <SplitShell collapsed sidebar={<Sidebar />}>
        <Detail label="Sidebar collapsed — the detail pane takes the full width." />
      </SplitShell>
    </div>
  ),
};

export const WideSidebar: Story = {
  render: () => (
    <div style={{ height: "100vh" }}>
      <SplitShell
        defaultSidebarWidth={460}
        maxSidebarWidth={620}
        sidebar={<Sidebar />}
      >
        <Detail label="A wider default, for a tablet in landscape." />
      </SplitShell>
    </div>
  ),
};
