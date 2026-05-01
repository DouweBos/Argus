import type { Meta, StoryObj } from "@storybook/react";
import {
  ShortcutCheatsheet,
  type ShortcutCheatsheetEntry,
} from "./ShortcutCheatsheet";

const meta: Meta<typeof ShortcutCheatsheet> = {
  title: "Git/ShortcutCheatsheet",
  component: ShortcutCheatsheet,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof ShortcutCheatsheet>;

const ALL: readonly ShortcutCheatsheetEntry["scopes"][number][] = [
  "session",
  "project",
];

const SHORTCUTS: ShortcutCheatsheetEntry[] = [
  {
    id: "view-working-copy",
    combo: "Cmd+1",
    label: "Working Copy",
    scopes: ALL,
    contexts: ["global"],
  },
  {
    id: "view-history",
    combo: "Cmd+3",
    label: "History",
    scopes: ALL,
    contexts: ["global"],
  },
  {
    id: "toggle-sidebar",
    combo: "Cmd+\\",
    label: "Toggle git sidebar",
    scopes: ALL,
    contexts: ["global"],
  },
  {
    id: "jump-to-ref",
    combo: "Cmd+L",
    label: "Jump to ref…",
    scopes: ALL,
    contexts: ["global"],
  },
  {
    id: "stage-all",
    combo: "Shift+Cmd+E",
    label: "Stage all",
    scopes: ALL,
    contexts: ["working-copy"],
  },
  {
    id: "stage-selected",
    combo: "Cmd+S",
    label: "Stage selection",
    scopes: ALL,
    contexts: ["working-copy"],
  },
  {
    id: "discard-selected",
    combo: "Cmd+D",
    label: "Discard selection",
    scopes: ALL,
    contexts: ["working-copy"],
  },
  {
    id: "next-hunk",
    combo: "Cmd+]",
    label: "Next hunk",
    scopes: ALL,
    contexts: ["working-copy"],
  },
  {
    id: "copy-commit-hash",
    combo: "Cmd+C",
    label: "Copy commit hash",
    scopes: ALL,
    contexts: ["history"],
  },
  {
    id: "open-commit",
    combo: "Enter",
    label: "Open commit",
    scopes: ALL,
    contexts: ["history"],
  },
  {
    id: "commit-now",
    combo: "Cmd+Enter",
    label: "Commit",
    scopes: ALL,
    contexts: ["commit-composer"],
  },
  {
    id: "amend-last",
    combo: "Shift+Cmd+A",
    label: "Amend last commit",
    scopes: ALL,
    contexts: ["commit-composer", "working-copy"],
  },
  {
    id: "project-only-example",
    combo: "Cmd+B",
    label: "Switch branch (project only, Phase 6)",
    scopes: ["project"],
    contexts: ["global"],
  },
];

const noop = () => undefined;

export const Default: Story = {
  args: {
    open: true,
    shortcuts: SHORTCUTS,
    scope: "session",
    onClose: noop,
  },
};

export const Filtered: Story = {
  args: {
    open: true,
    shortcuts: SHORTCUTS,
    scope: "session",
    onClose: noop,
  },
  parameters: {
    docs: {
      description: {
        story:
          "User has typed “stage” into the filter — only stage / unstage entries remain visible.",
      },
    },
  },
  render: (args) => <ShortcutCheatsheet {...args} />,
};

export const ProjectScope: Story = {
  args: {
    open: true,
    shortcuts: SHORTCUTS,
    scope: "project",
    onClose: noop,
  },
};

export const Empty: Story = {
  args: {
    open: true,
    shortcuts: [],
    scope: "session",
    onClose: noop,
  },
};
