import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { DirectoryBrowser } from "./DirectoryBrowser";

const meta: Meta<typeof DirectoryBrowser> = {
  title: "Components/DirectoryBrowser",
  component: DirectoryBrowser,
  parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof DirectoryBrowser>;

const entries = [
  { name: "Argus", path: "/Users/douwe/Projects/Argus", isRepo: true },
  {
    name: "peacock-playground",
    path: "/Users/douwe/Projects/peacock-playground",
  },
  { name: "ghost", path: "/Users/douwe/Projects/ghost", isRepo: true },
  { name: "scratch", path: "/Users/douwe/Projects/scratch" },
];

export const Browsing: Story = {
  render: () => {
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <div style={{ width: 420, height: 280, display: "flex" }}>
        <DirectoryBrowser
          entries={entries}
          path="/Users/douwe/Projects"
          parent="/Users/douwe"
          selectedPath={selected}
          onHome={() => setSelected(null)}
          onNavigate={() => undefined}
          onSelect={setSelected}
        />
      </div>
    );
  },
};

export const Loading: Story = {
  render: () => (
    <div style={{ width: 420, height: 200, display: "flex" }}>
      <DirectoryBrowser
        entries={[]}
        loading
        path="/Volumes/Work"
        parent="/Volumes"
        onNavigate={() => undefined}
      />
    </div>
  ),
};

export const AtRoot: Story = {
  render: () => (
    <div style={{ width: 420, height: 200, display: "flex" }}>
      <DirectoryBrowser
        entries={[]}
        parent={null}
        path="/"
        error="Permission denied reading /"
        onNavigate={() => undefined}
      />
    </div>
  ),
};
