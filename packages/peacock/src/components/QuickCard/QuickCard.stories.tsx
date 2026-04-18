import type { Meta, StoryObj } from "@storybook/react";
import { QuickCard, MiniStat } from "./QuickCard";

const meta: Meta<typeof QuickCard> = {
  title: "Composites/QuickCard",
  component: QuickCard,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof QuickCard>;

export const TodayAtAGlance: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <QuickCard heading="Today at a glance">
        <MiniStat label="Agents started" value={34} accent />
        <MiniStat label="Merges landed" value={4} />
        <MiniStat label="Tokens" value="2.14M" />
        <MiniStat label="Simulators" value={2} />
      </QuickCard>
    </div>
  ),
};
