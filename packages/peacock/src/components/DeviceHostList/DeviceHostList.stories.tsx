import type { Meta, StoryObj } from "@storybook/react";
import { DeviceHostList, type DeviceHostRowData } from "./DeviceHostList";

const hosts: DeviceHostRowData[] = [
  {
    id: "rh1",
    label: "Studio Mac",
    kind: "ssh",
    statusLabel: "Connected",
    tone: "success",
  },
  {
    id: "rh2",
    label: "Build box",
    kind: "ssh",
    statusLabel: "Unreachable",
    tone: "warning",
  },
  {
    id: "eh1",
    label: "Expo cloud",
    kind: "eas",
    statusLabel: "EAS · 1 of 2 running",
    tone: "success",
  },
];

const meta: Meta<typeof DeviceHostList> = {
  title: "Components/DeviceHostList",
  component: DeviceHostList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Device hosts a computer streams simulators from: Macs over SSH and EAS Simulator hosts. EAS rows can start a billed session (confirm first). Rows come from `deviceHostView` in `@argus/client-core`.",
      },
    },
  },
  args: { hosts, onStart: () => {}, onRetry: () => {} },
};

export default meta;

type Story = StoryObj<typeof DeviceHostList>;

export const Default: Story = {};

export const MonitorOnly: Story = { args: { onStart: undefined } };

export const Starting: Story = { args: { busyId: "eh1" } };

export const Started: Story = {
  args: {
    notes: {
      eh1: {
        text: "Starting. The device shows up under Devices once it's ready.",
      },
    },
  },
};

export const StartFailed: Story = {
  args: {
    notes: {
      eh1: { text: "The computer didn't answer in time.", failed: true },
    },
  },
};

export const AtLimit: Story = {
  args: {
    hosts: [
      {
        id: "eh1",
        label: "Expo cloud",
        kind: "eas",
        statusLabel: "EAS · 2 of 2 running",
        tone: "success",
        full: true,
      },
    ],
  },
};

export const WithFooter: Story = {
  args: { footer: "Add or remove hosts in Argus on the computer." },
};

export const Loading: Story = { args: { hosts: null } };

export const LoadFailed: Story = {
  args: { hosts: null, error: "Not connected to the computer." },
};

export const RefreshFailed: Story = {
  args: { error: "The computer didn't answer in time." },
};

export const Empty: Story = { args: { hosts: [] } };
