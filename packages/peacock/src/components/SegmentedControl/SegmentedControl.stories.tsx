import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";

const meta: Meta<typeof SegmentedControl> = {
  title: "Primitives/SegmentedControl",
  component: SegmentedControl,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj;

function ModeSwitch({ size }: { size?: "md" | "sm" }) {
  const [mode, setMode] = useState<"inspect" | "simulate">("simulate");

  return (
    <SegmentedControl
      aria-label="Runtime mode"
      size={size}
      value={mode}
      onChange={setMode}
      options={[
        { label: "Simulate", value: "simulate" },
        { label: "Inspect", value: "inspect" },
      ]}
    />
  );
}

export const Small: Story = { render: () => <ModeSwitch /> };
export const Medium: Story = { render: () => <ModeSwitch size="md" /> };

export const WithDisabled: Story = {
  render: () => {
    const [v, setV] = useState<"a" | "b" | "c">("a");

    return (
      <SegmentedControl
        value={v}
        onChange={setV}
        options={[
          { label: "Draft", value: "a" },
          { label: "Review", value: "b" },
          { label: "Ship", value: "c", disabled: true },
        ]}
      />
    );
  },
};
