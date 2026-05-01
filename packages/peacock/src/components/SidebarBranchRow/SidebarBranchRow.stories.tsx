import type { Meta, StoryObj } from "@storybook/react";
import { SidebarBranchFolder, SidebarBranchRow } from "./SidebarBranchRow";

const meta: Meta<typeof SidebarBranchRow> = {
  title: "Git/SidebarBranchRow",
  component: SidebarBranchRow,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, background: "var(--surface-2)", padding: 8 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SidebarBranchRow>;

export const Default: Story = {
  args: { name: "feature-login" },
};

export const Current: Story = {
  args: { name: "main", current: true },
};

export const CurrentWithAhead: Story = {
  args: { name: "fix-android-rn-screens", current: true, ahead: 1 },
};

export const AheadAndBehind: Story = {
  args: { name: "rng-109-broadcast", ahead: 190, behind: 2 },
};

export const BehindOnly: Story = {
  args: { name: "main", behind: 13 },
};

export const WithPR: Story = {
  args: { name: "maestro-ci-cd", prNumber: 5077 },
};

export const PRAndDiverged: Story = {
  args: {
    name: "str-3758-favorites-coach-mark-2ab",
    prNumber: 5225,
    ahead: 60,
    behind: 1,
  },
};

export const Indented: Story = {
  args: { name: "backup", depth: 1 },
};

export const InFolder: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <SidebarBranchFolder name="douwe" depth={0} />
      <SidebarBranchRow name="backup" depth={1} />
      <SidebarBranchRow
        name="fix-android-rn-screens"
        depth={1}
        current
        ahead={1}
      />
      <SidebarBranchRow name="maestro-ci-cd" depth={1} prNumber={5077} />
      <SidebarBranchRow
        name="rng-109-broadcast"
        depth={1}
        prNumber={5072}
        ahead={190}
        behind={2}
      />
      <SidebarBranchFolder name="ruud" depth={0} />
      <SidebarBranchRow name="fast-image-memory-pressure" depth={1} />
      <SidebarBranchRow
        name="perf-skip-a11y-when-screen-reader-off"
        depth={1}
      />
    </div>
  ),
};

export const FolderCollapsed: Story = {
  render: () => <SidebarBranchFolder name="houwert" collapsed />,
};
