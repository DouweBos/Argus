import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toggle } from "./Toggle";

const meta: Meta<typeof Toggle> = {
  title: "Primitives/Toggle",
  component: Toggle,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Toggle>;

function Controlled({
  initial = false,
  size,
  label,
  disabled,
}: {
  disabled?: boolean;
  initial?: boolean;
  label?: string;
  size?: "md" | "sm";
}) {
  const [on, setOn] = useState(initial);

  return (
    <Toggle checked={on} onChange={setOn} size={size} disabled={disabled}>
      {label}
    </Toggle>
  );
}

export const Off: Story = { render: () => <Controlled /> };
export const On: Story = { render: () => <Controlled initial /> };
export const WithLabel: Story = {
  render: () => <Controlled label="A11y badges" />,
};
export const Medium: Story = {
  render: () => <Controlled initial label="Stream logs" size="md" />,
};
export const Disabled: Story = {
  render: () => <Controlled initial disabled label="Locked" />,
};
