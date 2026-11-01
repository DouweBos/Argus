import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TerminalIcon } from "../../icons/Icons";
import { MenuChip, type MenuChipOption } from "./MenuChip";

const AUTONOMY: MenuChipOption[] = [
  { value: "", label: "Inherit", hint: "Use the computer's default" },
  {
    value: "propose",
    label: "Propose",
    hint: "Put it in the inbox and touch nothing.",
  },
  {
    value: "draft",
    label: "Draft",
    hint: "Open a worktree, implement it, commit.",
  },
  {
    value: "pr",
    label: "Pull request",
    hint: "Also open a draft pull request.",
  },
];

const meta: Meta<typeof MenuChip> = {
  title: "Primitives/MenuChip",
  component: MenuChip,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof MenuChip>;

function Live({ icon, showsTitle }: { icon?: boolean; showsTitle?: boolean }) {
  const [value, setValue] = useState("");

  return (
    <MenuChip
      leading={icon ? <TerminalIcon size={11} /> : undefined}
      options={AUTONOMY}
      showsTitle={showsTitle}
      title="Autonomy"
      value={value}
      onChange={setValue}
    />
  );
}

export const WithTitle: Story = { render: () => <Live showsTitle /> };

export const ValueOnly: Story = { render: () => <Live /> };

export const WithIcon: Story = { render: () => <Live icon showsTitle /> };

export const Disabled: Story = {
  args: {
    disabled: true,
    options: AUTONOMY,
    showsTitle: true,
    title: "Autonomy",
    value: "draft",
    onChange: () => undefined,
  },
};
