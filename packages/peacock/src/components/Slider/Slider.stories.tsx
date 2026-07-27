import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Slider } from "./Slider";

const meta: Meta<typeof Slider> = {
  title: "Primitives/Slider",
  component: Slider,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Slider>;

function Controlled({
  initial = 50,
  label,
  disabled,
  min = 0,
  max = 100,
  step = 1,
}: {
  disabled?: boolean;
  initial?: number;
  label?: string;
  max?: number;
  min?: number;
  step?: number;
}) {
  const [value, setValue] = useState(initial);

  return (
    <div style={{ width: 240 }}>
      <Slider
        value={value}
        onChange={setValue}
        label={label}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

export const Default: Story = { render: () => <Controlled /> };
export const WithLabel: Story = { render: () => <Controlled label="Size" /> };
export const Stepped: Story = {
  render: () => (
    <Controlled label="Zoom" min={1} max={5} step={1} initial={2} />
  ),
};
export const Disabled: Story = {
  render: () => <Controlled label="Locked" disabled initial={30} />,
};
