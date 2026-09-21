import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { ReportRefList } from "./ReportRefList";

const SESSIONS: Record<string, { subtitle: string; title: string }> = {
  "s-1": { title: "fix/cold-start-crash", subtitle: "argus · merged" },
  "s-2": { title: "feat/report-blocks", subtitle: "peacock · 3 files changed" },
};

const meta: Meta<typeof ReportRefList> = {
  title: "Data/Report/ReportRefList",
  component: ReportRefList,
  tags: ["autodocs"],
  render: (args) => (
    <div style={{ width: 620 }}>
      <ReportRefList {...args} />
    </div>
  ),
  args: {
    kind: "session",
    ids: ["s-1", "s-2"],
    resolve: (id) => {
      const found = SESSIONS[id];

      return found
        ? {
            id,
            ...found,
            meta: <Badge tone="success">ready</Badge>,
            onOpen: () => undefined,
          }
        : null;
    },
  },
};
export default meta;
type Story = StoryObj<typeof ReportRefList>;

export const Sessions: Story = {};

export const Proposals: Story = {
  args: {
    kind: "proposal",
    ids: ["p-1", "p-2"],
    resolve: (id) => ({
      id,
      title:
        id === "p-1" ? "Fix the flaky merge test" : "Bump the release notes",
      subtitle: "argus · start a session",
      meta: <Badge tone="accent">0.82</Badge>,
      onOpen: () => undefined,
    }),
  },
};

export const Unresolved: Story = {
  args: { kind: "proposal", ids: ["gone-1"], resolve: () => null },
};

export const Mixed: Story = {
  args: { ids: ["s-1", "gone", "s-2"] },
};
