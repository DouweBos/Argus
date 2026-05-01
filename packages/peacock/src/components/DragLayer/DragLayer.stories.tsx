import type { Meta, StoryObj } from "@storybook/react";
import { useDraggable, useDropTarget } from "../../lib/dnd";
import { DragLayer } from "./DragLayer";

const meta: Meta<typeof DragLayer> = {
  title: "Utilities/DragLayer",
  component: DragLayer,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Globally-mounted floating badge that follows the cursor during drag operations. Mount once at the app shell. Renders nothing when idle.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof DragLayer>;

/**
 * When nothing is being dragged the DragLayer renders nothing.
 */
export const Idle: Story = {
  render: () => (
    <div
      style={{
        padding: 24,
        color: "var(--text-secondary)",
        font: "var(--type-body)",
      }}
    >
      <DragLayer />
      <p>No drag in progress — DragLayer renders nothing.</p>
    </div>
  ),
};

/**
 * Drag the branch chip over the drop zone to see the floating badge appear.
 * Hold ⌥ (Option) while hovering to switch to the alternate label.
 */
export const BranchOnBranch: Story = {
  render: () => {
    return <BranchOnBranchDemo />;
  },
};

function BranchOnBranchDemo() {
  const drag = useDraggable({
    kind: "branch",
    branchName: "feature/my-work",
    isCurrent: false,
  });

  const drop = useDropTarget<{
    branchName: string;
    isCurrent: boolean;
    kind: "branch";
  }>({
    accepts: ["branch"],
    label: "Merge feature/my-work into main",
    modifiers: {
      alt: {
        label: "Rebase feature/my-work onto main",
        onDrop: (_payload) => {
          alert("Rebase!");
        },
      },
      shift: {
        label: "Revert feature/my-work on main",
        onDrop: (_payload) => {
          alert("Revert!");
        },
      },
    },
    onDrop: (_payload) => {
      alert("Merge!");
    },
  });

  return (
    <div
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <DragLayer />
      <p
        style={{
          color: "var(--text-secondary)",
          font: "var(--type-body)",
          margin: 0,
        }}
      >
        Drag the chip onto the drop zone. Hold ⌥ while hovering to switch to the
        rebase label, or ⇧ for revert. Shift takes precedence over alt when both
        are held.
      </p>
      <div
        {...drag}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "6px 12px",
          borderRadius: "var(--border-radius-sm)",
          background: "var(--accent-overlay-lg)",
          color: "var(--accent)",
          font: "var(--type-ui)",
          cursor: "grab",
          border: "1px solid var(--accent-border-soft)",
          width: "fit-content",
        }}
      >
        feature/my-work
      </div>
      <div
        {...drop}
        style={{
          padding: 20,
          borderRadius: "var(--border-radius-md)",
          border: `2px dashed ${drop.isOver ? "var(--accent)" : "var(--border)"}`,
          background: drop.isOver ? "var(--accent-overlay-sm)" : "transparent",
          color: drop.isOver ? "var(--accent)" : "var(--text-muted)",
          font: "var(--type-body)",
          transition: "all var(--transition-fast)",
          textAlign: "center",
        }}
      >
        main (drop zone) — {drop.isOver ? "ready to drop!" : "drag here"}
      </div>
    </div>
  );
}

/**
 * Demonstrates the alt-modifier badge appearance on a "Branches" section header target.
 */
export const BranchOnSectionHeader: Story = {
  render: () => <BranchOnSectionHeaderDemo />,
};

function BranchOnSectionHeaderDemo() {
  const drag = useDraggable({
    kind: "branch",
    branchName: "feature/awesome",
    isCurrent: false,
  });

  const drop = useDropTarget<{
    branchName: string;
    isCurrent: boolean;
    kind: "branch";
  }>({
    accepts: ["branch"],
    label: "Branch from feature/awesome",
    onDrop: (_payload) => {
      alert("Create branch from feature/awesome");
    },
  });

  return (
    <div
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <DragLayer />
      <p
        style={{
          color: "var(--text-secondary)",
          font: "var(--type-body)",
          margin: 0,
        }}
      >
        Drag the branch onto the &quot;Branches&quot; section header to see the
        create-branch badge.
      </p>
      <div
        {...drag}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "6px 12px",
          borderRadius: "var(--border-radius-sm)",
          background: "var(--accent-overlay-lg)",
          color: "var(--accent)",
          font: "var(--type-ui)",
          cursor: "grab",
          border: "1px solid var(--accent-border-soft)",
          width: "fit-content",
        }}
      >
        feature/awesome
      </div>
      <div
        {...drop}
        style={{
          padding: "8px 12px",
          borderRadius: "var(--border-radius-sm)",
          border: `2px dashed ${drop.isOver ? "var(--accent)" : "var(--border)"}`,
          background: drop.isOver
            ? "var(--accent-overlay-sm)"
            : "var(--surface-2)",
          color: drop.isOver ? "var(--accent)" : "var(--text-secondary)",
          font: "var(--type-eyebrow)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          transition: "all var(--transition-fast)",
        }}
      >
        BRANCHES
      </div>
    </div>
  );
}
