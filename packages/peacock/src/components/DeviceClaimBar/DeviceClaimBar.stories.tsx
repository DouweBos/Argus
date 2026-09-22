import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeviceClaimBar } from "./DeviceClaimBar";

const meta: Meta<typeof DeviceClaimBar> = {
  title: "Components/DeviceClaimBar",
  component: DeviceClaimBar,
  args: {
    holderLabel: null,
    mine: false,
    onTakeControl: () => {},
    onRelease: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DeviceClaimBar>;

export const Free: Story = {};

export const Yours: Story = {
  args: { holderLabel: "You", mine: true },
};

export const SomeoneElse: Story = {
  args: { holderLabel: "Ana", mine: false },
};

export const ReadOnly: Story = {
  args: { holderLabel: "Ana", mine: false, readOnly: true },
};
