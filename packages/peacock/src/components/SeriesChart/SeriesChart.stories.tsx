import type { Meta, StoryObj } from "@storybook/react";
import { SeriesChart } from "./SeriesChart";

const meta: Meta<typeof SeriesChart> = {
  title: "Data/SeriesChart",
  component: SeriesChart,
  tags: ["autodocs"],
  args: {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    values: [4, 9, 6, 12, 7],
    caption: "Sessions merged",
  },
  render: (args) => (
    <div style={{ width: 620 }}>
      <SeriesChart {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof SeriesChart>;

export const Bar: Story = {};

export const Line: Story = {
  args: { kind: "line", caption: "Agent minutes" },
};

export const DenseSeries: Story = {
  args: {
    kind: "line",
    caption: "Runs per day",
    labels: Array.from({ length: 30 }, (_, i) => `${i + 1}`),
    values: Array.from({ length: 30 }, (_, i) =>
      Math.round(20 + 12 * Math.sin(i / 3) + (i % 5)),
    ),
  },
};

export const Negatives: Story = {
  args: {
    caption: "Net lines changed",
    labels: ["peacock", "host", "app", "docs"],
    values: [820, -240, 1310, -90],
  },
};

export const LargeValues: Story = {
  args: {
    caption: "Tokens used",
    labels: ["Mon", "Tue", "Wed", "Thu"],
    values: [1_240_000, 880_000, 2_100_000, 1_650_000],
  },
};

export const CustomFormat: Story = {
  args: {
    kind: "line",
    caption: "Daily cost",
    labels: Array.from({ length: 14 }, (_, i) => `Oct ${i + 1}`),
    values: Array.from({ length: 14 }, (_, i) =>
      Math.round(4000 + 2500 * Math.sin(i / 2) + i * 120),
    ).map((v) => v / 100),
    formatValue: (value: number) => `$${value.toFixed(0)}`,
  },
};

export const SinglePoint: Story = {
  args: { labels: ["Today"], values: [3], caption: "Proposals" },
};
