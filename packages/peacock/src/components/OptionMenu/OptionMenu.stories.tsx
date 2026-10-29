import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PropertyButton } from "../PropertyButton/PropertyButton";
import { OptionMenu } from "./OptionMenu";

const meta: Meta<typeof OptionMenu> = {
  title: "Components/OptionMenu",
  component: OptionMenu,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof OptionMenu>;

const STATES = [
  ["backlog", "Backlog", "backlog"],
  ["todo", "Todo", "unstarted"],
  ["progress", "In Progress", "started"],
  ["review", "In Review", "started"],
  ["done", "Done", "completed"],
  ["canceled", "Canceled", "canceled"],
] as const;

export const StatusMenu: Story = {
  render: () => {
    const ref = useRef<HTMLButtonElement>(null);
    const [value, setValue] = useState("todo");
    const current = STATES.find((s) => s[0] === value);

    return (
      <div
        style={{
          padding: 24,
          height: "100vh",
          background: "var(--bg-primary)",
        }}
      >
        <PropertyButton
          ref={ref}
          icon={<IssueStatusIcon type={current?.[2] ?? "unstarted"} />}
          label={current?.[1] ?? ""}
          expanded
        />
        <OptionMenu
          hint="S"
          items={STATES.map(([v, label, type], i) => ({
            value: v,
            label,
            icon: <IssueStatusIcon type={type} />,
            shortcut: String((i + 1) % 10),
          }))}
          placeholder="Change status…"
          selected={value}
          triggerRef={ref}
          onClose={() => {}}
          onSelect={setValue}
        />
      </div>
    );
  },
};
