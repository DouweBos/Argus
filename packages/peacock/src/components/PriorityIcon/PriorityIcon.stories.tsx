import type { Meta, StoryObj } from "@storybook/react";
import { PRIORITY_LABELS, PriorityIcon } from "./PriorityIcon";

const meta: Meta<typeof PriorityIcon> = {
  title: "Components/PriorityIcon",
  component: PriorityIcon,
};

export default meta;

type Story = StoryObj<typeof PriorityIcon>;

export const AllPriorities: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      {[1, 2, 3, 4, 0].map((p) => (
        <span key={p} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <PriorityIcon priority={p} />
          {PRIORITY_LABELS[p]}
        </span>
      ))}
    </div>
  ),
};
