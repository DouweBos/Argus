import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { GitChangesIcon, SimulatorIcon, TerminalIcon } from "../../icons/Icons";
import { EmptyState } from "../EmptyState/EmptyState";
import { SidePanel } from "./SidePanel";

const meta: Meta<typeof SidePanel> = {
  title: "Composites/SidePanel",
  component: SidePanel,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof SidePanel>;

type Tab = "changes" | "device" | "terminal";

const TABS = [
  { id: "device" as const, title: "Device", icon: <SimulatorIcon size={13} /> },
  {
    id: "terminal" as const,
    title: "Terminal",
    icon: <TerminalIcon size={13} />,
  },
  {
    id: "changes" as const,
    title: "Changes",
    icon: <GitChangesIcon size={13} />,
  },
];

function Panel() {
  const [tab, setTab] = useState<Tab>("device");

  return (
    <div style={{ width: 380, height: 520, display: "flex" }}>
      <SidePanel<Tab>
        selectedId={tab}
        tabs={TABS}
        onClose={() => {}}
        onSelect={setTab}
      >
        <EmptyState
          icon={TABS.find((t) => t.id === tab)?.icon}
          title={`${TABS.find((t) => t.id === tab)?.title} tab`}
          body="Whatever the tab shows fills the rest of the panel."
        />
      </SidePanel>
    </div>
  );
}

export const Default: Story = { render: () => <Panel /> };
