import type { Meta, StoryObj } from "@storybook/react";
import { StatsStrip, StatCell } from "./StatsStrip";

const meta: Meta<typeof StatsStrip> = {
  title: "Composites/StatsStrip",
  component: StatsStrip,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof StatsStrip>;

export const HomeScreen: Story = {
  render: () => (
    <div style={{ width: 900 }}>
      <StatsStrip>
        <StatCell
          label="Agents running"
          value={5}
          delta="+2 in last hour"
          deltaTone="positive"
          live
        />
        <StatCell
          label="Started today"
          value={34}
          delta="▲ 11 vs yesterday"
          deltaTone="positive"
        />
        <StatCell label="Merges this week" value={17} delta="4 today" />
        <StatCell label="Tokens today" value="2.14M" delta="sonnet · haiku" />
        <StatCell label="Simulators" value={2} delta="1 iOS · 1 Android" />
      </StatsStrip>
    </div>
  ),
};
