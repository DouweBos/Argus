import type { Meta, StoryObj } from "@storybook/react";
import { GitGraphCell, type GraphRow } from "./GitGraphCell";

const meta: Meta<typeof GitGraphCell> = {
  title: "Primitives/GitGraphCell",
  component: GitGraphCell,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof GitGraphCell>;

function row(partial: Partial<GraphRow>): GraphRow {
  return {
    color: 0,
    column: 0,
    forks: [],
    isMerge: false,
    laneColorMap: new Map(),
    laneCount: 1,
    lanesToBottom: [0],
    lanesToTop: [0],
    merges: [],
    ...partial,
  };
}

const rowHeight = 28;

export const Linear: Story = {
  render: () => (
    <div style={{ background: "var(--bg-1, #111)", padding: 12 }}>
      {[0, 1, 2].map((i) => (
        <GitGraphCell
          key={i}
          row={row({ laneColorMap: new Map([[0, 3]]) })}
          rowHeight={rowHeight}
        />
      ))}
    </div>
  ),
};

export const MergeAndFork: Story = {
  render: () => {
    const colorMap = new Map([
      [0, 3],
      [1, 0],
    ]);

    return (
      <div style={{ background: "var(--bg-1, #111)", padding: 12 }}>
        <GitGraphCell
          row={row({
            column: 0,
            laneCount: 2,
            laneColorMap: colorMap,
            lanesToTop: [0],
            lanesToBottom: [0, 1],
            forks: [{ fromCol: 0, toCol: 1 }],
          })}
          rowHeight={rowHeight}
        />
        <GitGraphCell
          row={row({
            column: 0,
            laneCount: 2,
            laneColorMap: colorMap,
            lanesToTop: [0, 1],
            lanesToBottom: [0, 1],
          })}
          rowHeight={rowHeight}
        />
        <GitGraphCell
          row={row({
            column: 0,
            laneCount: 2,
            laneColorMap: colorMap,
            isMerge: true,
            lanesToTop: [0, 1],
            lanesToBottom: [0],
            merges: [{ fromCol: 1, toCol: 0 }],
          })}
          rowHeight={rowHeight}
        />
      </div>
    );
  },
};
