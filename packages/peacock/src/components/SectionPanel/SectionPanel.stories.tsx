import type { Meta, StoryObj } from "@storybook/react";
import { SectionPanel } from "./SectionPanel";

const meta: Meta<typeof SectionPanel> = {
  title: "Components/SectionPanel",
  component: SectionPanel,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof SectionPanel>;

export const WithMetaAndAction: Story = {
  args: {
    title: "Sessions",
    meta: "5 total",
    action: (
      <button
        type="button"
        style={{
          fontSize: 11,
          color: "var(--accent)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        New
      </button>
    ),
    children: (
      <div
        style={{
          padding: 16,
          color: "var(--text-muted)",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        No sessions yet. Create one to start a branch.
      </div>
    ),
  },
};

export const TitleOnly: Story = {
  args: {
    title: "Chat history",
    meta: "16 sessions",
    children: (
      <div style={{ padding: 16, color: "var(--text-muted)" }}>
        (list of entries)
      </div>
    ),
  },
};

export const Plain: Story = {
  args: {
    plain: true,
    title: "Recent projects",
    meta: "3 pinned",
    children: (
      <div style={{ padding: 12, color: "var(--text-muted)" }}>
        Plain variant — no border or background, just the header.
      </div>
    ),
  },
};
