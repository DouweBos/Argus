import type { Meta, StoryObj } from "@storybook/react";
import { ClockIcon, LockIcon, SparklesIcon } from "../../icons/Icons";
import { Chip } from "./Chip";

const meta: Meta<typeof Chip> = {
  title: "Primitives/Chip",
  component: Chip,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Chip>;

export const ModelPicker: Story = {
  args: { mono: true, children: "sonnet-4.5" },
};
export const PlanMode: Story = { args: { muted: true, children: "Plan mode" } };
/** The Mac composer's row: bare chips that open menus. */
export const BareMenu: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 2 }}>
      <Chip bare interactive menu leading={<SparklesIcon size={12} />}>
        Claude Opus 5.5
      </Chip>
      <Chip bare interactive menu leading={<ClockIcon size={12} />}>
        Default
      </Chip>
      <Chip bare interactive menu muted leading={<LockIcon size={11} />}>
        Auto
      </Chip>
    </div>
  ),
};

export const Dismissible: Story = {
  args: {
    mono: true,
    children: "feat/session-card",
    onDismiss: () => {},
  },
};
