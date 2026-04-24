import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SendIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { ChatInputShell } from "./ChatInputShell";

const meta: Meta<typeof ChatInputShell> = {
  title: "Composites/ChatInputShell",
  component: ChatInputShell,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ChatInputShell>;

function Textarea({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={2}
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        outline: "none",
        color: "var(--text-primary)",
        font: "var(--type-body)",
        padding: "10px 12px 4px",
        resize: "none",
      }}
    />
  );
}

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState(
      "Refactor the session card to use the new…",
    );

    return (
      <div style={{ width: 480 }}>
        <ChatInputShell
          actions={
            <>
              <Chip mono>sonnet-4.5</Chip>
              <Chip muted>
                <ChatInputShell.CollapseLabel>
                  Plan mode
                </ChatInputShell.CollapseLabel>
              </Chip>
            </>
          }
          trailing={
            <Button variant="send" aria-label="Send">
              <SendIcon size={13} />
            </Button>
          }
        >
          <Textarea value={value} onChange={setValue} />
        </ChatInputShell>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div style={{ width: 480 }}>
      <ChatInputShell
        disabled
        trailing={
          <Button variant="send" aria-label="Send" disabled>
            <SendIcon size={13} />
          </Button>
        }
      >
        <Textarea
          value=""
          onChange={() => {}}
          placeholder="Agent is not running"
          disabled
        />
      </ChatInputShell>
    </div>
  ),
};

export const DragOver: Story = {
  render: () => (
    <div style={{ width: 480 }}>
      <ChatInputShell
        dragOver
        trailing={
          <Button variant="send" aria-label="Send">
            <SendIcon size={13} />
          </Button>
        }
      >
        <Textarea value="" onChange={() => {}} placeholder="Drop to attach…" />
      </ChatInputShell>
    </div>
  ),
};
