import type { Meta, StoryObj } from "@storybook/react";
import {
  SESSION_WORKFLOW_STATUSES,
  SESSION_WORKFLOW_STATUS_LABELS,
  SessionStatusIcon,
} from "./SessionStatusIcon";

const meta: Meta<typeof SessionStatusIcon> = {
  title: "Components/SessionStatusIcon",
  component: SessionStatusIcon,
};

export default meta;

type Story = StoryObj<typeof SessionStatusIcon>;

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      {SESSION_WORKFLOW_STATUSES.map((status) => (
        <span
          key={status}
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          <SessionStatusIcon size={14} status={status} />
          {SESSION_WORKFLOW_STATUS_LABELS[status]}
        </span>
      ))}
    </div>
  ),
};
