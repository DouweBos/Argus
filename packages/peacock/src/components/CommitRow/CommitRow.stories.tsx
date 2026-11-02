import type { Meta, StoryObj } from "@storybook/react";
import { CommitRow } from "./CommitRow";

const meta: Meta<typeof CommitRow> = {
  title: "Components/CommitRow",
  component: CommitRow,
};
export default meta;
type Story = StoryObj<typeof CommitRow>;

export const Default: Story = {
  args: {
    subject: "feat(web): land work from the browser",
    hash: "8aead07a1c2d",
    author: "Douwe Bos",
    age: "3h ago",
  },
};

export const Clickable: Story = {
  args: { ...Default.args, onClick: () => {} },
};

export const LongSubject: Story = {
  args: {
    ...Default.args,
    subject:
      "refactor(web): port quick open ranking, file search and terminal feed to client-core so desktop and web share one implementation",
  },
};

export const NoAuthor: Story = {
  args: { subject: "chore: bump", hash: "0123456" },
};
