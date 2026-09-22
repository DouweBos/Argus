import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SlashCommandList } from "./SlashCommandList";

const meta: Meta<typeof SlashCommandList> = {
  title: "Components/SlashCommandList",
  component: SlashCommandList,
};

export default meta;

type Story = StoryObj<typeof SlashCommandList>;

const COMMANDS = [
  { name: "commit", description: "Stage and commit local changes" },
  { name: "pr", description: "Open or update a pull request" },
  { name: "review-local", description: "Review the uncommitted changes" },
  { name: "cleanup", description: "Tear down the worktree and branch" },
  { name: "init" },
];

/** The list anchors above its composer, so the stage leaves room beneath. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 460,
        margin: "260px 24px 24px",
        padding: 12,
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--border-radius)",
        color: "var(--text-muted)",
        fontSize: 13,
      }}
    >
      {children}
      Type a message…
    </div>
  );
}

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState(1);

    return (
      <Stage>
        <SlashCommandList
          items={COMMANDS}
          selectedIndex={selected}
          onSelect={setSelected}
          onSelectedIndexChange={setSelected}
        />
      </Stage>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <Stage>
      <SlashCommandList
        items={[]}
        selectedIndex={0}
        onSelect={() => {}}
        onSelectedIndexChange={() => {}}
      />
    </Stage>
  ),
};
