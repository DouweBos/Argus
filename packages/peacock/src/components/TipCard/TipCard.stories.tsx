import type { Meta, StoryObj } from "@storybook/react";
import { TipCard } from "./TipCard";

const Star = () => (
  <svg width={11} height={11} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0l1.7 4.8 4.8 1.7-4.8 1.7L8 13l-1.7-4.8L1.5 6.5l4.8-1.7Z" />
  </svg>
);

const meta: Meta<typeof TipCard> = {
  title: "Composites/TipCard",
  component: TipCard,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof TipCard>;

export const Trio: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
        width: 720,
      }}
    >
      <TipCard
        icon={<Star />}
        title="Spin up parallel ideas"
        body="Every workspace is an isolated git worktree. Run five attempts side-by-side — none step on each other."
      />
      <TipCard
        icon={<Star />}
        title="Approve only what you need"
        body="The permission broker lets you allow a single tool call, or always-allow a pattern. Stop agents running away."
      />
      <TipCard
        icon={<Star />}
        title="Drive simulators from the agent"
        body="The conductor CLI is pre-wired. Agents tap, scroll, type in your simulators for real UI testing."
      />
    </div>
  ),
};
