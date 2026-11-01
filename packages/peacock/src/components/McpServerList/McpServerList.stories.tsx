import type { Meta, StoryObj } from "@storybook/react";
import { McpServerList, type McpServerRowData } from "./McpServerList";

const servers: McpServerRowData[] = [
  {
    name: "figma",
    displayName: "figma",
    state: "failed",
    stateLabel: "Failed",
    detail: "spawn npx ENOENT",
  },
  {
    name: "claude.ai Slack",
    displayName: "claude.ai Slack",
    state: "needs-auth",
    stateLabel: "Needs sign-in",
    detail: "claude.ai connector",
  },
  {
    name: "argus",
    displayName: "argus",
    state: "connected",
    stateLabel: "Connected",
    detail: "Argus · 34 tools",
  },
  {
    name: "plugin:team-tools:linear",
    displayName: "linear",
    state: "pending",
    stateLabel: "Connecting",
    detail: "team-tools plugin",
  },
  {
    name: "sentry",
    displayName: "sentry",
    state: "disabled",
    stateLabel: "Disabled",
    detail: "Project .mcp.json",
  },
];

const meta: Meta<typeof McpServerList> = {
  title: "Components/McpServerList",
  component: McpServerList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The MCP servers an agent's CLI loaded and whether each connected, with what needs you first. Rows come from `mcpServerViews` in `@argus/client-core`.",
      },
    },
  },
  args: { servers, onRetry: () => {} },
};

export default meta;

type Story = StoryObj<typeof McpServerList>;

export const Default: Story = {};

export const RunningAsAccount: Story = {
  args: { account: "Running as Work" },
};

export const Loading: Story = { args: { servers: null } };

export const LoadFailed: Story = {
  args: { servers: null, error: "The computer didn't answer in time." },
};

export const RefreshFailed: Story = {
  args: { error: "Not connected to the computer." },
};

export const Unsupported: Story = { args: { servers: "unsupported" } };

export const NoServers: Story = { args: { servers: [] } };
