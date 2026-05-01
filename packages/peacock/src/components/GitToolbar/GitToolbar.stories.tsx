import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { GitToolbar, defaultGitToolbarGroups } from "./GitToolbar";

const meta: Meta<typeof GitToolbar> = {
  title: "Composites/GitToolbar",
  component: GitToolbar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;
type Story = StoryObj<typeof GitToolbar>;

function Demo({
  searchPlaceholder = "Search for File",
}: {
  searchPlaceholder?: string;
}) {
  const [value, setValue] = useState("");
  const [last, setLast] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <GitToolbar
        groups={defaultGitToolbarGroups({
          onPull: () => setLast("pull"),
          onPush: () => setLast("push"),
          onStash: () => setLast("stash"),
          onBranch: () => setLast("branch"),
          onTag: () => setLast("tag"),
          onMerge: () => setLast("merge"),
          onUndo: () => setLast("undo"),
          onRedo: () => setLast("redo"),
          onRefresh: () => setLast("refresh"),
        })}
        searchPlaceholder={searchPlaceholder}
        searchValue={value}
        onSearchChange={setValue}
        onSearchSubmit={(v) => setLast(`submit: ${v}`)}
      />
      <div
        style={{
          padding: "0 14px",
          font: "11px/1.4 var(--font-mono)",
          color: "var(--text-muted)",
        }}
      >
        last action: {last ?? "—"}
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <Demo />,
};

export const HistoryViewSearch: Story = {
  render: () => <Demo searchPlaceholder="Search for Message" />,
};

export const SomeDisabled: Story = {
  render: () => (
    <GitToolbar
      groups={defaultGitToolbarGroups(
        {},
        { undo: true, redo: true, merge: true },
      )}
      searchPlaceholder="Search for File"
    />
  ),
};
