import type { WindowTabItem } from "./WindowTabStrip";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { WindowTabStrip } from "./WindowTabStrip";

const meta: Meta<typeof WindowTabStrip> = {
  title: "Layout/WindowTabStrip",
  component: WindowTabStrip,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof WindowTabStrip>;

const local: WindowTabItem = {
  id: "local",
  title: "This Mac",
  hostLabel: "This Mac",
  local: true,
  pinned: true,
};

const noop = () => undefined;

/** One local tab is just "the window" — the machine name is left off. */
export const OnlyTheLocalTab: Story = {
  render: () => (
    <WindowTabStrip
      tabs={[{ ...local, active: true }]}
      onClose={noop}
      onNew={noop}
      onSelect={noop}
    />
  ),
};

/** Two or more tabs: each says which machine it drives. */
export const SeveralMachines: Story = {
  render: () => (
    <WindowTabStrip
      tabs={[
        local,
        {
          id: "t2",
          title: "fix-login",
          subtitle: "Argus",
          hostLabel: "Mac mini",
          active: true,
        },
        {
          id: "t3",
          title: "docs-tweak",
          hostLabel: "Mac mini",
          state: "reconnecting",
        },
      ]}
      onClose={noop}
      onNew={noop}
      onSelect={noop}
    />
  ),
};

export const DisconnectedHost: Story = {
  render: () => (
    <WindowTabStrip
      tabs={[
        { ...local, active: true },
        {
          id: "t2",
          title: "release-notes",
          hostLabel: "Android box",
          state: "disconnected",
        },
      ]}
      onClose={noop}
      onNew={noop}
      onSelect={noop}
    />
  ),
};

export const Overflow: Story = {
  render: () => (
    <WindowTabStrip
      tabs={[
        local,
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `t${i}`,
          title: `feature/really-long-branch-name-${i}`,
          hostLabel: i % 2 === 0 ? "Mac mini" : "Linux box",
          active: i === 3,
          state: i === 7 ? ("disconnected" as const) : undefined,
        })),
      ]}
      onClose={noop}
      onNew={noop}
      onSelect={noop}
    />
  ),
};

export const Interactive: Story = {
  render: function Interactive() {
    const [tabs, setTabs] = useState<WindowTabItem[]>([
      { ...local, active: true },
      { id: "t2", title: "fix-login", hostLabel: "Mac mini" },
    ]);
    const select = (id: string) =>
      setTabs((prev) => prev.map((t) => ({ ...t, active: t.id === id })));

    return (
      <WindowTabStrip
        tabs={tabs}
        onClose={(id) => setTabs((prev) => prev.filter((t) => t.id !== id))}
        onNew={() =>
          setTabs((prev) => [
            ...prev,
            {
              id: `t${prev.length + 1}`,
              title: "New tab",
              hostLabel: "This Mac",
              local: true,
            },
          ])
        }
        onReorder={(fromId, targetId, side) =>
          setTabs((prev) => {
            const from = prev.find((t) => t.id === fromId);
            if (!from) {
              return prev;
            }
            const without = prev.filter((t) => t.id !== fromId);
            const at = without.findIndex((t) => t.id === targetId);
            without.splice(side === "before" ? at : at + 1, 0, from);

            return without;
          })
        }
        onSelect={select}
      />
    );
  },
};
