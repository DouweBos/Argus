import type { Meta, StoryObj } from "@storybook/react";
import { GuestList } from "./GuestList";

const meta: Meta<typeof GuestList> = {
  title: "Components/GuestList",
  component: GuestList,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof GuestList>;

export const Empty: Story = {
  args: { guests: [] },
};

export const OneWaiting: Story = {
  args: {
    guests: [{ id: "a", label: "Ana", state: "pending", connected: true }],
    onApprove: () => {},
    onDeny: () => {},
  },
};

/** Three guests, two of them reaching for the simulator — the case to design for. */
export const ThreeGuests: Story = {
  args: {
    guests: [
      {
        id: "a",
        label: "Ana Ruiz",
        state: "approved",
        connected: true,
        driving: true,
      },
      { id: "b", label: "Ben", state: "approved", connected: true },
      { id: "c", label: "Chidi Okafor", state: "pending", connected: true },
    ],
    onApprove: () => {},
    onDeny: () => {},
  },
};

/** Several pending at once — no cap, and they sort above everyone already in. */
export const Crowded: Story = {
  args: {
    guests: [
      { id: "a", label: "Ana Ruiz", state: "approved", connected: true },
      { id: "b", label: "Ben", state: "approved", connected: false },
      { id: "c", label: "Chidi Okafor", state: "pending", connected: true },
      { id: "d", label: "Dana", state: "pending", connected: true },
      { id: "e", label: "Eli", state: "denied", connected: false },
    ],
    onApprove: () => {},
    onDeny: () => {},
  },
};

/** Read-only: no decisions to make, so no buttons. */
export const ReadOnly: Story = {
  args: {
    guests: [
      {
        id: "a",
        label: "Ana Ruiz",
        state: "approved",
        connected: true,
        driving: true,
      },
      { id: "b", label: "Ben", state: "approved", connected: true },
    ],
  },
};

/** With `onRemove`, everyone already decided on can be taken back out. */
export const Removable: Story = {
  args: {
    guests: [
      { id: "a", label: "Ana Ruiz", state: "approved", connected: true },
      { id: "b", label: "Ben", state: "approved", connected: false },
      { id: "c", label: "Chidi Okafor", state: "pending", connected: true },
    ],
    onApprove: () => {},
    onDeny: () => {},
    onRemove: () => {},
  },
};

/** Someone mid-sentence — the typing line replaces the standing line. */
export const SomeoneTyping: Story = {
  args: {
    guests: [
      {
        id: "a",
        label: "Ana",
        state: "approved",
        connected: true,
        typing: true,
      },
      { id: "b", label: "Bo", state: "approved", connected: true },
    ],
    onRemove: () => {},
  },
};
