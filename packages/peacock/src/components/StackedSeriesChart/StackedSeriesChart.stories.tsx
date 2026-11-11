import type { Meta, StoryObj } from "@storybook/react";
import { StackedSeriesChart } from "./StackedSeriesChart";

const days = ["Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5", "Oct 6", "Oct 7"];
const usd = (value: number) => `$${value.toFixed(0)}`;

const meta: Meta<typeof StackedSeriesChart> = {
  title: "Data/StackedSeriesChart",
  component: StackedSeriesChart,
  tags: ["autodocs"],
  args: {
    caption: "Daily cost",
    labels: days,
    formatValue: usd,
    series: [
      { label: "Claude Code", values: [40, 72, 18, 95, 61, 80, 46] },
      { label: "Codex", values: [12, 8, 30, 14, 22, 0, 18] },
      { label: "Gemini", values: [0, 4, 6, 2, 9, 12, 3] },
    ],
  },
  render: (args) => (
    <div style={{ width: 620 }}>
      <StackedSeriesChart {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof StackedSeriesChart>;

export const Bars: Story = {};

export const Areas: Story = {
  args: {
    kind: "line",
    labels: Array.from({ length: 60 }, (_, i) => `Day ${i + 1}`),
    series: [
      {
        label: "Claude Code",
        values: Array.from({ length: 60 }, (_, i) =>
          Math.round(40 + 20 * Math.sin(i / 4)),
        ),
      },
      {
        label: "Codex",
        values: Array.from({ length: 60 }, (_, i) =>
          Math.round(15 + 10 * Math.cos(i / 6)),
        ),
      },
    ],
  },
};

export const WithOther: Story = {
  args: {
    series: [
      { label: "Claude Code", values: [40, 72, 18, 95, 61, 80, 46] },
      { label: "Codex", values: [12, 8, 30, 14, 22, 0, 18] },
      { label: "Gemini", values: [0, 4, 6, 2, 9, 12, 3] },
      { label: "Cursor", values: [6, 0, 3, 8, 2, 5, 1] },
      { label: "Other runners", values: [2, 1, 0, 3, 1, 2, 4], other: true },
    ],
  },
};

export const Hourly: Story = {
  args: {
    caption: "Hourly processed tokens",
    formatValue: undefined,
    labels: Array.from(
      { length: 24 },
      (_, i) => `${String(i).padStart(2, "0")}:00`,
    ),
    series: [
      {
        label: "Claude Code",
        values: Array.from({ length: 24 }, (_, i) =>
          i < 8 ? 0 : 400_000 + ((i * 97_000) % 600_000),
        ),
      },
      {
        label: "OpenCode",
        values: Array.from({ length: 24 }, (_, i) =>
          i < 10 ? 0 : (i * 53_000) % 300_000,
        ),
      },
    ],
  },
};
