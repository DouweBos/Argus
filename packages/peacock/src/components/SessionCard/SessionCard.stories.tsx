import type { Meta, StoryObj } from "@storybook/react";
import {
  BranchIcon,
  EllipsisIcon,
  PlusIcon,
  RepoIcon,
} from "../../icons/Icons";
import { AgentRow } from "../AgentRow/AgentRow";
import { SessionCard } from "./SessionCard";

const meta: Meta<typeof SessionCard> = {
  title: "Composites/SessionCard",
  component: SessionCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 300 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SessionCard>;

const ellipsis = <EllipsisIcon size={12} />;

export const WorktreeSelected: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "Add SSDP discovery support",
    selected: true,
    interactive: true,
    actionReveal: "hover",
    diff: { added: 1125, removed: 100 },
    actions: ellipsis,
  },
};

export const WithPullRequest: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {(["open", "draft", "merged", "closed"] as const).map((state, i) => (
        <SessionCard
          key={state}
          icon={<BranchIcon size={13} />}
          title={`Session with a ${state} PR`}
          interactive
          actionReveal="hover"
          pullRequest={{ number: 120 + i, state, onOpen: () => undefined }}
          diff={{ added: 12, removed: 3 }}
          actions={ellipsis}
        />
      ))}
    </div>
  ),
};

export const HoverActions: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "Hover me to reveal actions",
    interactive: true,
    actionReveal: "hover",
    diff: { added: 71, removed: 15 },
    actions: ellipsis,
  },
};

export const ProjectRoot: Story = {
  args: {
    icon: <RepoIcon size={13} />,
    title: "react-native-client",
    interactive: true,
    actionReveal: "hover",
    subtitle: "douwe/drawer-menu — remote control web client",
  },
};

export const Initializing: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "Vizbee watch version casting",
    interactive: true,
    actionReveal: "hover",
    status: { label: "initializing", tone: "warning" },
  },
};

export const ErrorState: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "Broken worktree",
    interactive: true,
    actionReveal: "hover",
    status: { label: "error", tone: "error", title: "setup command failed" },
  },
};

export const AgentRunning: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "Command palette iPad keyboard",
    interactive: true,
    iconPulse: true,
    iconTitle: "1 agent running",
    actionReveal: "hover",
    showUnread: true,
    diff: { added: 1859, removed: 1 },
    actions: ellipsis,
  },
};

export const WebGroup: Story = {
  args: {
    icon: <RepoIcon size={13} />,
    title: "DOUWE/DRAWER-MENU",
    actionReveal: "always",
    kind: { label: "root", tone: "accent" },
    actions: ellipsis,
    children: (
      <>
        <AgentRow name="Agent 6189788d" status="idle" meta="Project root" />
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 4,
          }}
        >
          <PlusIcon size={12} /> New agent in this session
        </button>
      </>
    ),
  },
};

export const WebWorktree: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "CHAT EXTENSION INTEGRATION",
    actionReveal: "always",
    kind: { label: "worktree", tone: "neutralFilled" },
    diff: { added: 1555, removed: 36 },
    divergence: { ahead: 1, behind: 541, dirty: 1 },
    subtitle: "douwe/poc-chat-extension-integration",
    actions: ellipsis,
  },
};

export const Framed: Story = {
  args: {
    framed: true,
    icon: <BranchIcon size={13} />,
    title: "Tidy the settings screen",
    actionReveal: "always",
    kind: { label: "worktree", tone: "neutralFilled" },
    diff: { added: 42, removed: 8 },
    subtitle: "douwe/tidy-settings",
    actions: ellipsis,
  },
};

/** Lives on an external drive — marked whether or not it is connected. */
export const OnExternalDrive: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "CarPlay external video routing",
    drive: "Blackbox",
    interactive: true,
    actionReveal: "hover",
    diff: { added: 42, removed: 7 },
    actions: ellipsis,
  },
};

/**
 * The drive holding this session is disconnected. It keeps its last known
 * branch and name — that is the whole point, the row is a reminder of what is
 * on the drive — but it is dimmed and cannot be opened.
 */
export const Unavailable: Story = {
  args: {
    icon: <BranchIcon size={13} />,
    title: "Fix the login redirect",
    interactive: true,
    unavailable: true,
    drive: "Blackbox",
    unavailableTitle: "Blackbox isn't connected — showing the last known state",
    status: { label: "unavailable", tone: "neutral" },
    subtitle: "douwe/fix-login-redirect",
  },
};

/** Still the selected row: the URL points here until the drive comes back. */
export const UnavailableSelected: Story = {
  args: {
    ...Unavailable.args,
    selected: true,
  },
};
