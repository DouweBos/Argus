import type { Meta, StoryObj } from "@storybook/react";
import { EmptyStateIllustration } from "./EmptyStateIllustration";

const meta: Meta<typeof EmptyStateIllustration> = {
  title: "Primitives/EmptyStateIllustration",
  component: EmptyStateIllustration,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof EmptyStateIllustration>;

export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24 }}>
      <EmptyStateIllustration variant="welcome" />
      <EmptyStateIllustration variant="success" />
      <EmptyStateIllustration variant="offline" />
    </div>
  ),
};
