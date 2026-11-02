import type { Meta, StoryObj } from "@storybook/react";
import {
  IntegrationStatusList,
  type IntegrationStatusRowData,
} from "./IntegrationStatusList";

const integrations: IntegrationStatusRowData[] = [
  {
    id: "linear",
    name: "Linear",
    stateLabel: "Connected",
    tone: "success",
    account: "Ada Lovelace · Acme",
  },
  {
    id: "figma",
    name: "Figma",
    stateLabel: "Not connected",
    tone: "neutral",
    account: null,
  },
];

const meta: Meta<typeof IntegrationStatusList> = {
  title: "Components/IntegrationStatusList",
  component: IntegrationStatusList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Read-only: which integrations a computer has connected, and as whom. Rows come from `integrationView` in `@argus/client-core`.",
      },
    },
  },
  args: { integrations, onRetry: () => {} },
};

export default meta;

type Story = StoryObj<typeof IntegrationStatusList>;

export const Default: Story = {};

export const NeedsReauth: Story = {
  args: {
    integrations: [
      {
        id: "linear",
        name: "Linear",
        stateLabel: "Reconnect",
        tone: "warning",
        account: "Ada Lovelace · Acme",
      },
      integrations[1]!,
    ],
  },
};

export const Loading: Story = { args: { integrations: null } };

export const LoadFailed: Story = {
  args: { integrations: null, error: "Not connected to the computer." },
};

export const Empty: Story = { args: { integrations: [] } };
