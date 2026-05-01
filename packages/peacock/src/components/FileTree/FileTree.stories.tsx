import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileTree, buildFileTree, type FileTreeLeaf } from "./FileTree";

const meta: Meta<typeof FileTree> = {
  title: "Primitives/FileTree",
  component: FileTree,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof FileTree>;

const SAMPLE: Omit<FileTreeLeaf, "label">[] = [
  { path: "src/components/Button.tsx", status: "M", statusKind: "modified" },
  { path: "src/components/Card.tsx", status: "A", statusKind: "added" },
  { path: "src/lib/api.ts", status: "M", statusKind: "modified" },
  { path: "src/lib/utils.ts", status: "D", statusKind: "deleted" },
  { path: "docs/readme.md", status: "M", statusKind: "modified" },
  { path: "package.json", status: "M", statusKind: "modified" },
];

function Demo({ collapse = true }: { collapse?: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["src"]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const nodes = buildFileTree(SAMPLE, { collapseSingles: collapse });

  return (
    <div style={{ width: 320, border: "1px solid var(--border)" }}>
      <FileTree
        nodes={nodes}
        expanded={expanded}
        selected={selected}
        onToggleExpand={(path) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
              next.delete(path);
            } else {
              next.add(path);
            }

            return next;
          })
        }
        onSelect={(path) => setSelected(new Set([path]))}
      />
    </div>
  );
}

export const Default: Story = { render: () => <Demo /> };
export const NoCollapse: Story = { render: () => <Demo collapse={false} /> };
export const Empty: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <FileTree
        nodes={[]}
        expanded={new Set()}
        selected={new Set()}
        onToggleExpand={() => {}}
        onSelect={() => {}}
      />
    </div>
  ),
};
