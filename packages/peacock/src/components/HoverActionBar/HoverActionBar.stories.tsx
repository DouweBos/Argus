import type { Meta, StoryObj } from "@storybook/react";
import { BranchIcon, CopyIcon } from "../../icons/Icons";
import { HoverActionBar, HoverActionButton } from "./HoverActionBar";

const meta: Meta<typeof HoverActionBar> = {
  title: "Primitives/HoverActionBar",
  component: HoverActionBar,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Hover-revealed cluster of icon buttons anchored to a corner of its positioned parent. Pairs with HoverActionButton. Callers toggle visibility from their own `:hover` rules — the stories below force it visible for docs.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof HoverActionBar>;

const Host = ({
  children,
  width = 320,
  height = 120,
}: {
  children: React.ReactNode;
  height?: number;
  width?: number;
}) => (
  <div
    style={{
      position: "relative",
      width,
      height,
      padding: 16,
      border: "1px solid var(--border-color)",
      borderRadius: 8,
      background: "var(--bg-secondary)",
      color: "var(--text-primary)",
      fontSize: 13,
      lineHeight: 1.5,
    }}
  >
    <p style={{ margin: 0 }}>
      A block of host content. Any text underneath the bar is masked by its
      gradient backdrop so the icons remain legible.
    </p>
    {children}
  </div>
);

export const TopRight: Story = {
  render: () => (
    <Host>
      <HoverActionBar placement="top-right" style={{ opacity: 1, pointerEvents: "auto" }}>
        <HoverActionButton
          icon={<CopyIcon size={12} />}
          label="Copy"
          onClick={() => {}}
        />
        <HoverActionButton
          icon={<BranchIcon size={12} />}
          label="Fork"
          onClick={() => {}}
        />
      </HoverActionBar>
    </Host>
  ),
};

export const TopLeft: Story = {
  render: () => (
    <Host>
      <HoverActionBar placement="top-left" style={{ opacity: 1, pointerEvents: "auto" }}>
        <HoverActionButton
          icon={<CopyIcon size={12} />}
          label="Copy"
          onClick={() => {}}
        />
      </HoverActionBar>
    </Host>
  ),
};

export const SingleAction: Story = {
  render: () => (
    <Host>
      <HoverActionBar placement="top-right" style={{ opacity: 1, pointerEvents: "auto" }}>
        <HoverActionButton
          icon={<BranchIcon size={12} />}
          label="Fork workspace"
          onClick={() => {}}
        />
      </HoverActionBar>
    </Host>
  ),
};
