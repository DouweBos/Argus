import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { MessageBubble } from "../MessageBubble/MessageBubble";
import { WorkLogRow } from "./WorkLogRow";

const meta: Meta<typeof WorkLogRow> = {
  title: "Components/WorkLogRow",
  component: WorkLogRow,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          'A turn\'s tool calls and narration folded into one quiet line ("Worked for 5m 29s") that opens in place. The label comes from `workLogLabel` in `@argus/client-core`.',
      },
    },
  },
  args: { onToggle: () => {} },
};

export default meta;

type Story = StoryObj<typeof WorkLogRow>;

const Work = () => (
  <>
    <MessageBubble
      role="assistant"
      textBlocks={["Let me look at the login form first."]}
    />
    <MessageBubble
      role="assistant"
      textBlocks={["Found it — the validation runs before the field blurs."]}
    />
  </>
);

export const Folded: Story = {
  args: { label: "Worked for 5m 29s", detail: "12 tool calls", open: false },
};

export const Open: Story = {
  args: {
    label: "Worked for 5m 29s",
    detail: "12 tool calls",
    open: true,
    children: <Work />,
  },
};

export const Working: Story = {
  args: { label: "Working for 12s", working: true, open: false },
};

export const BackgroundStillRunning: Story = {
  args: {
    label: "Worked for 2m 4s · 1 agent still running",
    working: true,
    open: false,
  },
};

export const LockedOpenOnADecision: Story = {
  args: {
    label: "Working for 40s",
    working: true,
    open: true,
    locked: true,
    children: <Work />,
  },
};

export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = useState(false);

    return (
      <WorkLogRow
        detail="3 tool calls"
        label="Worked for 48s"
        open={open}
        onToggle={() => setOpen((o) => !o)}
      >
        <Work />
      </WorkLogRow>
    );
  },
};
