import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AgentTabStrip, type AgentTab } from "./AgentTabStrip";

const meta: Meta<typeof AgentTabStrip> = {
  title: "Composites/AgentTabStrip",
  component: AgentTabStrip,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof AgentTabStrip>;

const TABS: AgentTab[] = [
  { id: "a", title: "New agent", status: "accent", busy: true },
  { id: "b", title: "Fix the sidebar", status: "warning" },
  { id: "c", title: "Review", status: "idle" },
];

function Strip({ tabs }: { tabs: AgentTab[] }) {
  const [selected, setSelected] = useState(tabs[0]?.id ?? null);
  const [open, setOpen] = useState(tabs);

  return (
    <AgentTabStrip
      selectedId={selected}
      tabs={open}
      onClose={(id) => setOpen((all) => all.filter((t) => t.id !== id))}
      onNew={() => {}}
      onSelect={setSelected}
    />
  );
}

export const Default: Story = { render: () => <Strip tabs={TABS} /> };

export const Single: Story = {
  render: () => <Strip tabs={TABS.slice(0, 1)} />,
};

/** Idle agents whose process was let go until the next message. */
export const Paused: Story = {
  render: () => (
    <Strip
      tabs={[
        { id: "a", title: "Fix the sidebar", status: "accent", busy: true },
        { id: "b", title: "Token audit", status: "idle", paused: true },
        { id: "c", title: "Release notes", status: "idle" },
        {
          id: "d",
          title: "Rework the onboarding flow for a brand new machine",
          status: "idle",
          paused: true,
        },
      ]}
    />
  ),
};

/** No agents yet: just the `+`. */
export const Empty: Story = { render: () => <Strip tabs={[]} /> };
