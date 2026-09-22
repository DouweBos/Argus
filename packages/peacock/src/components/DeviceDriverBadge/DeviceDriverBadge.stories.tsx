import type { Meta, StoryObj } from "@storybook/react";
import { DeviceDriverBadge } from "./DeviceDriverBadge";

const meta: Meta<typeof DeviceDriverBadge> = {
  title: "Components/DeviceDriverBadge",
  component: DeviceDriverBadge,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          height: 240,
          background: "var(--bg-tertiary)",
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DeviceDriverBadge>;

export const SomeoneDriving: Story = {
  args: { holderLabel: "Chris" },
};

/** The case this exists for: Chris is tapping and nothing is happening. */
export const SomeoneBlocked: Story = {
  args: { holderLabel: "Ana", waitingLabels: ["Chris"] },
};

export const AQueue: Story = {
  args: { holderLabel: "Ana", waitingLabels: ["Chris", "Bo", "Dev"] },
};

/** Nobody has taken the device — nothing to say, so nothing is drawn. */
export const Free: Story = {
  args: { holderLabel: null },
};
