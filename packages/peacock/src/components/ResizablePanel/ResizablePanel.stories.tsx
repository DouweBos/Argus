import type { Meta, StoryObj } from "@storybook/react";
import { ResizablePanel } from "./ResizablePanel";

const meta: Meta<typeof ResizablePanel> = {
  title: "Components/ResizablePanel",
  component: ResizablePanel,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof ResizablePanel>;

function Filler({ label }: { label: string }) {
  return (
    <div style={{ padding: 16, fontSize: 13, color: "var(--text-primary)" }}>
      {label}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "var(--bg-primary)",
      }}
    >
      {children}
    </div>
  );
}

export const Left: Story = {
  render: () => (
    <Frame>
      <ResizablePanel
        defaultWidth={280}
        maxWidth={520}
        minWidth={200}
        side="left"
        unit="pixel"
      >
        <Filler label="Sidebar — drag the right edge." />
      </ResizablePanel>
      <div style={{ flex: 1 }}>
        <Filler label="Main" />
      </div>
    </Frame>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <Frame>
      <ResizablePanel collapsed defaultWidth={280} side="left" unit="pixel">
        <Filler label="Hidden" />
      </ResizablePanel>
      <div style={{ flex: 1 }}>
        <Filler label="Sidebar slid out — still mounted." />
      </div>
    </Frame>
  ),
};

export const Peeking: Story = {
  render: () => (
    <Frame>
      <ResizablePanel
        collapsed
        peeking
        defaultWidth={280}
        side="left"
        unit="pixel"
      >
        <Filler label="Peeking overlay" />
      </ResizablePanel>
      <div style={{ flex: 1 }}>
        <Filler label="Main content does not reflow while the panel peeks." />
      </div>
    </Frame>
  ),
};

export const Bottom: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1 }}>
        <Filler label="Main" />
      </div>
      <ResizablePanel
        defaultWidth={0.3}
        maxWidth={0.7}
        minWidth={0.15}
        side="bottom"
      >
        <Filler label="Terminal — drag the top edge." />
      </ResizablePanel>
    </div>
  ),
};
