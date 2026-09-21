import type { ReportBlock } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { ReportView } from "./ReportView";

const SESSIONS: Record<string, string> = {
  "s-1": "fix/cold-start-crash",
  "s-2": "feat/report-blocks",
};

const FULL: ReportBlock[] = [
  { type: "heading", text: "Yesterday across four repos" },
  {
    type: "stats",
    items: [
      { label: "Sessions merged", value: "7", delta: 3 },
      { label: "Open PRs", value: "12", delta: -2 },
      { label: "Agent minutes", value: "94" },
      { label: "Cost", value: "$4.12" },
    ],
  },
  {
    type: "markdown",
    text: "Two of the merges came from **automations**; the rest were yours. Nothing is blocked on review.",
  },
  {
    type: "series",
    kind: "bar",
    label: "Sessions merged per day",
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    values: [4, 9, 6, 12, 7],
  },
  { type: "heading", text: "Oldest open work" },
  {
    type: "table",
    columns: ["Repo", "Open PRs", "Oldest"],
    rows: [
      ["argus", 6, "3d"],
      ["peacock", 2, "9h"],
      ["conductor", 11, "12d"],
    ],
  },
  {
    type: "list",
    items: [
      { text: "Release build is green on main", tone: "positive" },
      { text: "Simulator smoke test failed on iOS 18.2", tone: "critical" },
      {
        text: "#412 crash on cold start",
        tone: "info",
        href: "https://example.com/412",
      },
    ],
  },
  { type: "heading", text: "Waiting on you" },
  { type: "proposals", ids: ["p-1", "p-2"] },
  { type: "sessions", ids: ["s-1", "s-2", "gone"] },
];

const meta: Meta<typeof ReportView> = {
  title: "Data/Report/ReportView",
  component: ReportView,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  render: (args) => (
    <div style={{ width: 760 }}>
      <ReportView {...args} />
    </div>
  ),
  args: {
    blocks: FULL,
    resolveProposal: (id) => ({
      id,
      title:
        id === "p-1" ? "Fix the flaky merge test" : "Bump the release notes",
      subtitle: "argus · start a session",
      meta: <Badge tone="accent">0.82</Badge>,
      onOpen: () => undefined,
    }),
    resolveSession: (id) =>
      SESSIONS[id]
        ? {
            id,
            title: SESSIONS[id],
            subtitle: "argus",
            meta: <Badge tone="success">ready</Badge>,
            onOpen: () => undefined,
          }
        : null,
  },
};
export default meta;
type Story = StoryObj<typeof ReportView>;

/** Every block type in one report. Flip the toolbar theme to check light. */
export const FullReport: Story = {};

export const HeadingAndMarkdown: Story = {
  args: {
    blocks: [
      { type: "heading", text: "Standup digest" },
      {
        type: "markdown",
        text: "- Three sessions merged\n- One agent is still running\n\n`argus` is green.",
      },
    ],
  },
};

export const StatsAndSeries: Story = {
  args: { blocks: [FULL[1], FULL[3]] },
};

export const LineSeries: Story = {
  args: {
    blocks: [
      {
        type: "series",
        kind: "line",
        label: "Agent minutes per day",
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        values: [62, 81, 44, 94, 120, 18, 9],
      },
    ],
  },
};

export const TableAndList: Story = {
  args: { blocks: [FULL[5], FULL[6]] },
};

export const LiveCards: Story = {
  args: { blocks: [FULL[8], FULL[9]] },
};

export const UnresolvedRefs: Story = {
  args: {
    blocks: [FULL[8], FULL[9]],
    resolveProposal: () => null,
    resolveSession: () => null,
  },
};
