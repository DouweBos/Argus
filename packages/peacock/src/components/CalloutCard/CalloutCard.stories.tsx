import type { Meta, StoryObj } from "@storybook/react";
import * as Icons from "../../icons/Icons";
import { Button } from "../Button/Button";
import { IconBadge } from "../IconBadge/IconBadge";
import { CalloutCard } from "./CalloutCard";

const meta: Meta<typeof CalloutCard> = {
  title: "Components/CalloutCard",
  component: CalloutCard,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof CalloutCard>;

export const Accent: Story = {
  args: {
    tone: "accent",
    leading: (
      <IconBadge tone="accent">
        <Icons.GearIcon size={14} />
      </IconBadge>
    ),
    title: "Finish setting up this project",
    meta: "No .argus.json found — Argus needs it to know how to copy files, run commands, and allocate ports when creating sessions.",
    actions: (
      <Button
        variant="primary"
        size="sm"
        leading={<Icons.PlusIcon size={11} />}
      >
        Generate .argus.json
      </Button>
    ),
  },
};

export const Success: Story = {
  args: {
    tone: "neutral",
    leading: (
      <IconBadge tone="success">
        <Icons.MergeIcon size={14} />
      </IconBadge>
    ),
    title: "Ready to merge",
    meta: "3 commits ahead of main",
    actions: (
      <Button variant="primary" size="sm">
        Merge
      </Button>
    ),
  },
};

export const Warning: Story = {
  args: {
    tone: "warning",
    leading: (
      <IconBadge tone="warning">
        <Icons.GearIcon size={14} />
      </IconBadge>
    ),
    title: "Claude Code not installed",
    meta: "Agents cannot run until you install the CLI.",
  },
};

export const Error: Story = {
  args: {
    tone: "error",
    leading: (
      <IconBadge tone="error">
        <Icons.TrashIcon size={14} />
      </IconBadge>
    ),
    title: "Rebase onto main failed",
    meta: "Conflicts in src/App.tsx and 2 other files",
  },
};

export const WithFooterContent: Story = {
  args: {
    tone: "neutral",
    leading: (
      <IconBadge tone="success">
        <Icons.MergeIcon size={14} />
      </IconBadge>
    ),
    title: "Ready to merge",
    meta: "1 ahead · 1 behind main",
    actions: (
      <Button variant="primary" size="sm">
        Merge
      </Button>
    ),
    children: (
      <p>
        Adds detection for @changesets/cli projects and previews pending
        release notes before merging.
      </p>
    ),
  },
};
