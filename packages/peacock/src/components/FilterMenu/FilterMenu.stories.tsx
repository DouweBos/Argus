import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { Chip } from "../Chip/Chip";
import { FilterMenu } from "./FilterMenu";

const meta: Meta<typeof FilterMenu> = {
  title: "Components/FilterMenu",
  component: FilterMenu,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof FilterMenu>;

const FIELDS = [
  [
    { id: "status", label: "Status" },
    { id: "priority", label: "Priority" },
    { id: "labels", label: "Labels" },
  ],
  [{ id: "cycle", label: "Cycle" }],
  [{ id: "content", label: "Content", kind: "text" as const }],
];

const OPTIONS: Record<
  string,
  { value: string; label: string; count: number }[]
> = {
  status: [
    { value: "Todo", label: "Todo", count: 5 },
    { value: "In Progress", label: "In Progress", count: 1 },
  ],
  priority: [
    { value: "1", label: "Urgent", count: 1 },
    { value: "2", label: "High", count: 6 },
  ],
  labels: [
    { value: "Bug", label: "Bug", count: 7 },
    { value: "Casting", label: "Casting", count: 4 },
  ],
  cycle: [
    { value: "current", label: "Current cycle", count: 3 },
    { value: "Cycle 58", label: "Cycle 58", count: 2 },
  ],
};

function Stage({ initialField }: { initialField?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({
    priority: ["2"],
  });

  return (
    <div
      style={{
        padding: 24,
        height: "100vh",
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div ref={ref}>
        <Chip interactive>Filter</Chip>
        <FilterMenu
          fields={FIELDS}
          initialField={initialField}
          optionsFor={(id) => OPTIONS[id] ?? []}
          selected={(id) => selected[id] ?? []}
          triggerRef={ref}
          onClose={() => {}}
          onText={() => {}}
          onToggle={(id, value) =>
            setSelected((s) => {
              const current = s[id] ?? [];

              return {
                ...s,
                [id]: current.includes(value)
                  ? current.filter((v) => v !== value)
                  : [...current, value],
              };
            })
          }
        />
      </div>
    </div>
  );
}

export const Fields: Story = { render: () => <Stage /> };

export const Options: Story = {
  render: () => <Stage initialField="priority" />,
};
