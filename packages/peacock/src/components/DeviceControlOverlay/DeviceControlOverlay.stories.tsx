import type { Meta, StoryObj } from "@storybook/react";
import { DeviceControlOverlay } from "./DeviceControlOverlay";

/** Stand-in for the live device picture the overlay sits on. */
function Screen({ children }: { children?: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 320,
        height: 440,
        borderRadius: 12,
        background: "var(--media-bg)",
        border: "1px solid var(--border)",
        display: "grid",
        placeItems: "center",
        font: "var(--type-caption)",
        color: "var(--text-muted)",
      }}
    >
      Live device screen
      {children}
    </div>
  );
}

const meta: Meta<typeof DeviceControlOverlay> = {
  title: "Components/DeviceControlOverlay",
  component: DeviceControlOverlay,
  parameters: { layout: "centered" },
  render: (args) => (
    <Screen>
      <DeviceControlOverlay {...args} />
    </Screen>
  ),
};

export default meta;

type Story = StoryObj<typeof DeviceControlOverlay>;

/** Someone else is driving: input is blocked and takeover is one click away. */
export const SomeoneElseHasControl: Story = {
  args: { holderLabel: "Douwe's iPhone", onTakeControl: () => undefined },
};

/** Same arbitration, browser wording — one component, both surfaces. */
export const BrowserControlledByAnother: Story = {
  args: {
    holderLabel: "Mac mini",
    subject: "browser",
    onTakeControl: () => undefined,
  },
};

/** You hold the claim — nothing covers the picture. */
export const YouHaveControl: Story = {
  args: { holderLabel: null, onTakeControl: () => undefined },
};

/** The holder went idle for 30s and the claim lapsed: back to an open screen. */
export const ClaimLapsed: Story = {
  args: { holderLabel: null, onTakeControl: () => undefined },
};

/** At the host's own machine claims never apply, so the overlay never shows. */
export const HostLocal: Story = {
  args: { holderLabel: null, onTakeControl: () => undefined },
};
