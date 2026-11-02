import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  NotificationsList,
  type NotificationRowData,
} from "./NotificationsList";

const entries: NotificationRowData[] = [
  {
    id: "1",
    level: "error",
    message:
      "Couldn't create the worktree: branch feature/login already exists.",
    source: "sessions",
    count: 1,
    time: "just now",
  },
  {
    id: "2",
    level: "warning",
    message: "This computer runs an older Argus without usage.summary.",
    source: "usage",
    count: 4,
    time: "3m",
  },
  {
    id: "3",
    level: "error",
    message: "The computer didn't answer in time.",
    source: null,
    count: 12,
    time: "1h",
  },
];

const meta: Meta<typeof NotificationsList> = {
  title: "Composites/NotificationsList",
  component: NotificationsList,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The warnings and errors log, newest first, a repeat folded into one row with ×N. Rows and the summary come from `notificationRows` / `notificationsSummary` in `@argus/client-core`.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof NotificationsList>;

function Interactive({ initial }: { initial: NotificationRowData[] }) {
  const [rows, setRows] = useState(initial);
  const errors = rows.filter((r) => r.level === "error").length;

  return (
    <NotificationsList
      entries={rows}
      summary={
        rows.length === 0
          ? "Everything looks clear"
          : `${String(errors)} errors · ${String(rows.length - errors)} warnings`
      }
      onClearAll={() => setRows([])}
      onDismiss={(id) => setRows((r) => r.filter((e) => e.id !== id))}
    />
  );
}

export const WithEntries: Story = {
  render: () => <Interactive initial={entries} />,
};

export const Empty: Story = {
  render: () => <Interactive initial={[]} />,
};
