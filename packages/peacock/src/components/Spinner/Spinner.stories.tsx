import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "./Spinner";

const meta: Meta<typeof Spinner> = {
  title: "Primitives/Spinner",
  component: Spinner,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Spinner>;

export const ExtraSmall: Story = { args: { size: "xs" } };
export const Small: Story = { args: { size: "sm" } };
export const Medium: Story = { args: { size: "md" } };
export const Large: Story = { args: { size: "lg" } };
export const Neutral: Story = { args: { size: "md", tone: "neutral" } };
export const Muted: Story = { args: { size: "md", tone: "muted" } };

export const InButtonContext: Story = {
  render: () => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--border-radius-sm)",
        color: "var(--text-secondary)",
      }}
    >
      <Spinner size="sm" tone="muted" />
      <span>Inspecting…</span>
    </div>
  ),
};
