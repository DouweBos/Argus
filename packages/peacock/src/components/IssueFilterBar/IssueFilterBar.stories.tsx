import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { type IssueFilterChipData, IssueFilterBar } from "./IssueFilterBar";
import { IssueSearchField } from "./IssueSearchField";

const meta: Meta<typeof IssueFilterBar> = {
  title: "Screens/IssueFilterBar",
  component: IssueFilterBar,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Linear's filter row: Filter opens the field menu, each active filter is a chip whose operator flips it. Fields, options, wording and the row's updates come from `issueFilters` in `@argus/client-core`.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof IssueFilterBar>;

const FIELDS = [
  [
    { id: "status", label: "Status" },
    { id: "priority", label: "Priority" },
    { id: "labels", label: "Labels" },
  ],
  [{ id: "content", label: "Content", kind: "text" as const }],
];

const OPTIONS: Record<
  string,
  { label: string; value: string; count: number }[]
> = {
  status: [
    { value: "Todo", label: "Todo", count: 4 },
    { value: "In Progress", label: "In Progress", count: 2 },
  ],
  priority: [
    { value: "1", label: "Urgent", count: 1 },
    { value: "2", label: "High", count: 3 },
    { value: "0", label: "No priority", count: 2 },
  ],
  labels: [
    { value: "Bug", label: "Bug", count: 2 },
    { value: "Feature", label: "Feature", count: 4 },
  ],
};

function Bar({ initial }: { initial: IssueFilterChipData[] }) {
  const [chips, setChips] = useState(initial);

  return (
    <IssueFilterBar
      chips={chips}
      fields={FIELDS}
      optionsFor={(id) => OPTIONS[id] ?? []}
      selected={(id) =>
        chips.find((c) => c.field === id)?.value.split(", ") ?? []
      }
      onClear={() => setChips([])}
      onFlip={(id) =>
        setChips((all) =>
          all.map((c) =>
            c.field === id
              ? { ...c, operator: c.operator === "is" ? "is not" : "is" }
              : c,
          ),
        )
      }
      onRemove={(id) => setChips((all) => all.filter((c) => c.field !== id))}
      onText={() => {}}
      onToggle={(field, value) =>
        setChips((all) =>
          all.some((c) => c.field === field)
            ? all
            : [...all, { field, label: field, operator: "is", value }],
        )
      }
    />
  );
}

export const Empty: Story = { render: () => <Bar initial={[]} /> };

export const WithFilters: Story = {
  render: () => (
    <Bar
      initial={[
        {
          field: "priority",
          label: "Priority",
          operator: "is",
          value: "Urgent, High",
        },
        { field: "labels", label: "Labels", operator: "is not", value: "Bug" },
      ]}
    />
  ),
};

export const SearchField: Story = {
  render: () => <IssueSearchField query={null} onSearch={() => {}} />,
};
