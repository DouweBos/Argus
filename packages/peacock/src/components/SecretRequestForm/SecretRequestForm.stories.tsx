import type { Meta, StoryObj } from "@storybook/react";
import { SecretRequestForm } from "./SecretRequestForm";

const meta: Meta<typeof SecretRequestForm> = {
  title: "Agent/SecretRequestForm",
  component: SecretRequestForm,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof SecretRequestForm>;

export const ToFile: Story = {
  args: {
    label: "adb pairing code",
    reason: "Pair the Pixel 9 over Wi-Fi so I can install the debug build.",
    destination:
      "Saved to a private file on your computer for the agent to read, deleted within 24 hours.",
    onSubmit: () => {},
    onDecline: () => {},
  },
};

export const ToRunCommand: Story = {
  args: {
    label: "Expo token",
    reason: "Start an EAS build of the preview profile.",
    destination:
      "Set as EXPO_TOKEN for the “EAS build” run command, kept in memory only.",
    onSubmit: () => {},
    onDecline: () => {},
  },
};

export const NoReason: Story = {
  args: {
    label: "Staging password",
    destination:
      "Saved to a private file on your computer for the agent to read, deleted within 24 hours.",
    onSubmit: () => {},
    onDecline: () => {},
  },
};
