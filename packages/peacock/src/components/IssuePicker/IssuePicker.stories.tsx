import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { Chip } from "../Chip/Chip";
import { type IssuePickerItem, IssuePicker } from "./IssuePicker";

const meta: Meta<typeof IssuePicker> = {
  title: "Components/IssuePicker",
  component: IssuePicker,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof IssuePicker>;

const ISSUES: IssuePickerItem[] = [
  {
    id: "1",
    identifier: "ENG-123",
    title: "Login button does nothing on iPad",
    state: "Todo",
  },
  {
    id: "2",
    identifier: "ENG-131",
    title: "Settings screen ignores dark mode",
    state: "In Progress",
  },
  {
    id: "3",
    identifier: "ENG-140",
    title: "Crash when opening an empty playlist",
    state: "Backlog",
  },
];

function Stage(props: {
  error?: string;
  items: IssuePickerItem[];
  loading?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(["2"]);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "flex-end",
        padding: 24,
        background: "var(--bg-primary)",
      }}
    >
      <div ref={ref}>
        <Chip interactive>Linear issue</Chip>
        <IssuePicker
          error={props.error}
          items={props.items.filter((i) =>
            `${i.identifier} ${i.title}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )}
          loading={props.loading}
          query={query}
          selectedIds={selected}
          triggerRef={ref}
          onClose={() => {}}
          onQueryChange={setQuery}
          onToggle={(item) =>
            setSelected((s) =>
              s.includes(item.id)
                ? s.filter((id) => id !== item.id)
                : [...s, item.id],
            )
          }
        />
      </div>
    </div>
  );
}

export const Default: Story = { render: () => <Stage items={ISSUES} /> };

export const Loading: Story = { render: () => <Stage items={[]} loading /> };

export const Empty: Story = { render: () => <Stage items={[]} /> };

export const Failed: Story = {
  render: () => (
    <Stage
      error="Linear rejected the saved credential. Reconnect it in Settings → Integrations."
      items={[]}
    />
  ),
};
