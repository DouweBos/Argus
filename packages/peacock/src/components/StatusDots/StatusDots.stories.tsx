import type { Meta, StoryObj } from "@storybook/react";
import { StatusDots } from "./StatusDots";

const meta: Meta<typeof StatusDots> = {
  title: "Primitives/StatusDots",
  component: StatusDots,
  tags: ["autodocs"],
  argTypes: {
    state: {
      control: "inline-radio",
      options: ["idle", "running", "awaiting"],
    },
  },
};
export default meta;
type Story = StoryObj<typeof StatusDots>;

export const Idle: Story = { args: { state: "idle" } };
export const Running: Story = { args: { state: "running" } };
export const Awaiting: Story = { args: { state: "awaiting" } };

export const AllStates: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "center",
        }}
      >
        <StatusDots state="idle" />
        <small style={{ color: "var(--text-muted)" }}>idle</small>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "center",
        }}
      >
        <StatusDots state="running" />
        <small style={{ color: "var(--text-muted)" }}>running</small>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "center",
        }}
      >
        <StatusDots state="awaiting" />
        <small style={{ color: "var(--text-muted)" }}>awaiting</small>
      </div>
    </div>
  ),
};
