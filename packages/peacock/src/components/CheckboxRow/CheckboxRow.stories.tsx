import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CheckboxRow } from "./CheckboxRow";

const meta: Meta<typeof CheckboxRow> = {
  title: "Primitives/CheckboxRow",
  component: CheckboxRow,
  tags: ["autodocs"],
  args: { onChange: () => {} },
};
export default meta;
type Story = StoryObj<typeof CheckboxRow>;

export const Unchecked: Story = {
  args: {
    checked: false,
    label: "argus",
    detail: "~/Work/argus",
    trailing: "12 chats · 4h",
  },
};

export const Checked: Story = {
  args: { ...Unchecked.args, checked: true },
};

export const DisabledDone: Story = {
  args: {
    checked: true,
    disabled: true,
    label: "acme-web",
    detail: "~/Work/acme-web",
    trailing: "Added",
  },
};

export const LabelOnly: Story = {
  args: { checked: false, label: "Set upstream" },
};

const ROWS = [
  { name: "argus", path: "~/Work/argus", meta: "42 chats · 1m" },
  { name: "website", path: "~/Work/website", meta: "3 chats · 6d" },
  {
    name: "a-very-long-repository-name-that-overflows",
    path: "~/Work/clients/…/a-very-long-repository-name-that-overflows",
    meta: "1 chat · 92d",
  },
];

function ListDemo() {
  const [picked, setPicked] = useState<Set<string>>(new Set(["argus"]));

  return (
    <div>
      {ROWS.map((r) => (
        <CheckboxRow
          key={r.name}
          checked={picked.has(r.name)}
          label={r.name}
          detail={r.path}
          trailing={r.meta}
          onChange={(on) => {
            const next = new Set(picked);
            if (on) {
              next.add(r.name);
            } else {
              next.delete(r.name);
            }
            setPicked(next);
          }}
        />
      ))}
    </div>
  );
}

export const List: Story = { render: () => <ListDemo /> };
