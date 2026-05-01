import type { Meta, StoryObj } from "@storybook/react";
import { TreeNode } from "./TreeNode";

const meta: Meta<typeof TreeNode> = {
  title: "Primitives/TreeNode",
  component: TreeNode,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof TreeNode>;

const LeafRow = ({ label }: { label: string }) => (
  <div
    style={{
      padding: "6px 8px",
      borderRadius: 6,
      background: "var(--glass-bg)",
      border: "1px solid var(--glass-border)",
      color: "var(--text-primary)",
      fontSize: 12,
    }}
  >
    {label}
  </div>
);

const FolderHeader = ({ label }: { label: string }) => (
  <div
    style={{
      padding: "6px 8px",
      borderRadius: 6,
      background: "var(--surface-3)",
      border: "1px solid var(--border)",
      color: "var(--text-primary)",
      fontSize: 12,
      fontWeight: 500,
      display: "flex",
      alignItems: "center",
      gap: 6,
    }}
  >
    <span style={{ color: "var(--text-muted)" }}>›</span>
    {label}
  </div>
);

export const SingleLeaf: Story = {
  render: () => (
    <div style={{ padding: 16, width: 400 }}>
      <TreeNode root header={<LeafRow label="myapp://home" />} />
    </div>
  ),
};

export const FolderWithChildren: Story = {
  render: () => (
    <div style={{ padding: 16, width: 400 }}>
      <TreeNode root header={<FolderHeader label="Settings" />}>
        <TreeNode header={<LeafRow label="myapp://settings/profile" />} />
        <TreeNode header={<LeafRow label="myapp://settings/notifications" />} />
      </TreeNode>
    </div>
  ),
};

export const NestedFolders: Story = {
  render: () => (
    <div style={{ padding: 16, width: 400 }}>
      <TreeNode root header={<FolderHeader label="App" />}>
        <TreeNode header={<FolderHeader label="Settings" />}>
          <TreeNode header={<LeafRow label="myapp://settings/profile" />} />
          <TreeNode
            header={<LeafRow label="myapp://settings/notifications" />}
          />
        </TreeNode>
        <TreeNode header={<LeafRow label="myapp://home" />} />
      </TreeNode>
    </div>
  ),
};

export const CollapsedFolder: Story = {
  render: () => (
    <div style={{ padding: 16, width: 400 }}>
      <TreeNode
        root
        collapsed
        header={<FolderHeader label="Settings (collapsed)" />}
      >
        <TreeNode header={<LeafRow label="myapp://settings/profile" />} />
        <TreeNode header={<LeafRow label="myapp://settings/notifications" />} />
      </TreeNode>
    </div>
  ),
};

export const MixedTopLevel: Story = {
  render: () => (
    <div
      style={{
        padding: 16,
        width: 400,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <TreeNode root header={<LeafRow label="myapp://home" />} />
      <TreeNode root header={<FolderHeader label="Settings" />}>
        <TreeNode header={<LeafRow label="myapp://settings/profile" />} />
        <TreeNode header={<LeafRow label="myapp://settings/notifications" />} />
      </TreeNode>
      <TreeNode root header={<LeafRow label="myapp://debug" />} />
    </div>
  ),
};
