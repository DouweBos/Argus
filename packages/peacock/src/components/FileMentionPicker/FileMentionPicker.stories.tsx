import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileMentionPicker } from "./FileMentionPicker";

const meta: Meta<typeof FileMentionPicker> = {
  title: "Components/FileMentionPicker",
  component: FileMentionPicker,
};

export default meta;

type Story = StoryObj<typeof FileMentionPicker>;

const ITEMS = [
  { display: "src", isDir: true },
  { display: "AppShell.tsx", isDir: false, hint: "app/components/layout" },
  { display: "SplitShell.tsx", isDir: false, hint: "packages/peacock" },
  { display: "tokens.css", isDir: false, hint: "packages/peacock/src/styles" },
];

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 460,
        margin: "280px 24px 24px",
        padding: 12,
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--border-radius)",
        color: "var(--text-muted)",
        fontSize: 13,
      }}
    >
      {children}
      @app/
    </div>
  );
}

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState(0);

    return (
      <Stage>
        <FileMentionPicker
          headerText="app/"
          items={ITEMS}
          selectedIndex={selected}
          onSelect={setSelected}
          onSelectedIndexChange={setSelected}
        />
      </Stage>
    );
  },
};

export const WithLinkAction: Story = {
  render: () => (
    <Stage>
      <FileMentionPicker
        headerText="~/Projects"
        items={[
          { display: "~/Projects/Argus", isDir: true, isLinkAction: true },
          ...ITEMS,
        ]}
        selectedIndex={0}
        onSelect={() => {}}
        onSelectedIndexChange={() => {}}
      />
    </Stage>
  ),
};

export const NoMatches: Story = {
  render: () => (
    <Stage>
      <FileMentionPicker
        headerText="nothing/"
        items={[]}
        selectedIndex={0}
        onSelect={() => {}}
        onSelectedIndexChange={() => {}}
      />
    </Stage>
  ),
};
