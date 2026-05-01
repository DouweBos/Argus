import type { Meta, StoryObj } from "@storybook/react";
import { BlameGutter } from "./BlameGutter";

const meta: Meta<typeof BlameGutter> = {
  title: "Git/BlameGutter",
  component: BlameGutter,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof BlameGutter>;

const day = 86_400_000;
const now = Date.now();

export const Default: Story = {
  args: {
    chunks: [
      {
        commitHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        author: "Alice",
        authorEmail: "alice@example.com",
        authorTime: now - day,
        summary: "Initial commit",
        lineStart: 1,
        lineCount: 4,
      },
      {
        commitHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
        author: "Bob",
        authorTime: now - 5 * day,
        summary: "Add login flow",
        lineStart: 5,
        lineCount: 8,
      },
    ],
  },
};

export const LongAuthorNames: Story = {
  args: {
    chunks: [
      {
        commitHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
        author: "Christopher Augustine Vandermeerschen",
        authorTime: now - 30 * day,
        summary: "Refactor",
        lineStart: 1,
        lineCount: 6,
      },
    ],
  },
};

export const RecentChanges: Story = {
  args: {
    chunks: [
      {
        commitHash: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
        author: "Alice",
        authorTime: now - 60_000,
        summary: "Tweak",
        lineStart: 1,
        lineCount: 3,
      },
    ],
  },
};

export const OldChanges: Story = {
  args: {
    chunks: [
      {
        commitHash: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
        author: "Alice",
        authorTime: now - 800 * day,
        summary: "Initial",
        lineStart: 1,
        lineCount: 5,
      },
    ],
  },
};

export const Selected: Story = {
  args: {
    selectedHash: "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5",
    chunks: [
      {
        commitHash: "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5",
        author: "Alice",
        authorTime: now - 2 * day,
        summary: "Selected chunk",
        lineStart: 1,
        lineCount: 4,
      },
      {
        commitHash: "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
        author: "Bob",
        authorTime: now - 7 * day,
        summary: "Other",
        lineStart: 5,
        lineCount: 4,
      },
    ],
  },
};
