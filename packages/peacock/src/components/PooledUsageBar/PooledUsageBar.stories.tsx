import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { PooledUsageBar, PooledUsageHatch } from "./PooledUsageBar";

const meta: Meta<typeof PooledUsageBar> = {
  title: "Data/PooledUsageBar",
  component: PooledUsageBar,
  tags: ["autodocs"],
  render: (args) => (
    <div style={{ width: 320 }}>
      <PooledUsageBar {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof PooledUsageBar>;

const segments = [
  {
    id: "work",
    label: "Work",
    present: true,
    used: 0.62,
    title: "Work · max · 38% left · Resets in 2h 13m",
  },
  {
    id: "home",
    label: "Home",
    present: true,
    used: 0.2,
    title: "Home · pro · 80% left · Resets in 4h 2m",
  },
  {
    id: "side",
    label: "Side project",
    present: true,
    used: 0.05,
    title: "Side project · pro · 95% left",
  },
];

export const ThreeAccounts: Story = {
  args: { "aria-label": "Session pool", segments },
};

/** The next account to reset: what it gives back is hatched. */
export const Restoring: Story = {
  args: {
    "aria-label": "Session pool",
    segments: segments.map((s, i) => ({ ...s, restoring: i === 0 })),
  },
  render: (args) => (
    <div style={{ width: 320, display: "grid", gap: 8 }}>
      <PooledUsageBar {...args} />
      <span style={{ fontSize: 11 }}>
        <PooledUsageHatch /> Work resets in 2h 13m, giving back 21% of the pool
      </span>
    </div>
  ),
};

/** An account without the window leaves an outlined gap. */
export const WithGap: Story = {
  args: {
    "aria-label": "Weekly · Opus pool",
    tone: "danger",
    segments: [
      { ...segments[0]!, used: 1, title: "Work · max · 0% left" },
      { ...segments[1]!, present: false, title: "Home · No such limit" },
      { ...segments[2]!, used: 0.9, title: "Side project · 10% left" },
    ],
  },
};

function SelectableDemo() {
  const [selected, setSelected] = useState<string | null>("home");

  return (
    <div style={{ width: 320 }}>
      <PooledUsageBar
        aria-label="Session pool"
        segments={segments}
        selectedId={selected}
        tone="warning"
        onSelect={setSelected}
      />
    </div>
  );
}

export const Selectable: Story = { render: () => <SelectableDemo /> };

export const Small: Story = {
  args: { "aria-label": "Session pool", segments, size: "sm" },
};
