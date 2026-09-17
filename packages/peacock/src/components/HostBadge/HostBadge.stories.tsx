import type { Meta, StoryObj } from "@storybook/react-vite";
import { HostBadge } from "./HostBadge";

const meta: Meta<typeof HostBadge> = {
  title: "Primitives/HostBadge",
  component: HostBadge,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof HostBadge>;

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <HostBadge label="Mac mini" />
      <HostBadge label="Mac mini" state="reconnecting" />
      <HostBadge label="Android box" state="offline" />
      <HostBadge label="A rather long host name" />
    </div>
  ),
};
