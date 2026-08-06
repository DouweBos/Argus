import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Select } from "./Select";

const meta: Meta<typeof Select> = {
  title: "Primitives/Select",
  component: Select,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Select>;

const VERSIONS = ["0.27.2", "0.27.1", "0.27.0", "0.26.0"];

function Controlled({
  disabled,
  mono,
}: {
  disabled?: boolean;
  mono?: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <div style={{ width: 260 }}>
      <Select
        disabled={disabled}
        mono={mono}
        onChange={(e) => setValue(e.target.value)}
        value={value}
      >
        <option value="">Bundled (0.27.2)</option>
        {VERSIONS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    </div>
  );
}

export const Default: Story = { render: () => <Controlled /> };
export const Mono: Story = { render: () => <Controlled mono /> };
export const Disabled: Story = { render: () => <Controlled disabled /> };
