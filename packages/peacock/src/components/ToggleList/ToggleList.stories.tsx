import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ToggleList, type ToggleListOption } from "./ToggleList";

const PROJECTS: ToggleListOption[] = [
  { id: "/src/argus", label: "Argus" },
  { id: "/src/app", label: "Mobile app" },
  { id: "/src/old", label: "old", hint: "not open on this computer" },
];

const meta: Meta<typeof ToggleList> = {
  title: "Primitives/ToggleList",
  component: ToggleList,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ToggleList>;

function Live() {
  const [selection, setSelection] = useState(["/src/argus", "/src/old"]);

  return (
    <ToggleList
      emptyMessage="This computer has no projects registered."
      options={PROJECTS}
      selection={selection}
      onChange={setSelection}
    />
  );
}

export const Default: Story = { render: () => <Live /> };

export const Empty: Story = {
  args: {
    emptyMessage: "This computer reported no signal sources.",
    options: [],
    selection: [],
    onChange: () => undefined,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    emptyMessage: "",
    options: PROJECTS,
    selection: ["/src/app"],
    onChange: () => undefined,
  },
};
