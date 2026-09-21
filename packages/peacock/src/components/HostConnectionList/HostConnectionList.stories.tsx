import type { Meta, StoryObj } from "@storybook/react-vite";
import { HostConnectionList } from "./HostConnectionList";

const meta: Meta<typeof HostConnectionList> = {
  title: "Layout/HostConnectionList",
  component: HostConnectionList,
  parameters: { layout: "centered" },
  args: {
    onAttach: () => undefined,
    onDetach: () => undefined,
    onFocus: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof HostConnectionList>;

export const SeveralHostsAttached: Story = {
  args: {
    hosts: [
      {
        id: "local",
        label: "This Mac",
        local: true,
        attached: true,
        focused: false,
        state: "connected",
      },
      {
        id: "mini",
        label: "Mac mini",
        detail: "wss://mini.local:7777",
        attached: true,
        focused: true,
        state: "connected",
      },
      {
        id: "linux",
        label: "Android box",
        detail: "wss://droid.local:7777",
        attached: true,
        focused: false,
        state: "reconnecting",
      },
    ],
  },
};

export const OneHostDown: Story = {
  args: {
    hosts: [
      {
        id: "local",
        label: "This Mac",
        local: true,
        attached: true,
        focused: true,
        state: "connected",
      },
      {
        id: "mini",
        label: "Mac mini",
        detail: "Lid closed — agents keep running there",
        attached: true,
        focused: false,
        state: "failed",
      },
    ],
  },
};

export const NothingPairedYet: Story = {
  args: {
    hosts: [
      {
        id: "local",
        label: "This Mac",
        local: true,
        attached: true,
        focused: true,
        state: "connected",
      },
      {
        id: "studio",
        label: "Studio",
        detail: "Paired, not attached",
        attached: false,
        focused: false,
        state: "detached",
      },
    ],
  },
};
