import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/Button";
import { FeedbackDialog } from "./FeedbackDialog";

const meta: Meta<typeof FeedbackDialog> = {
  title: "Components/FeedbackDialog",
  component: FeedbackDialog,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof FeedbackDialog>;

function Shell({
  delay = 0,
  reject = false,
  unavailableReason,
}: {
  delay?: number;
  reject?: boolean;
  unavailableReason?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        background: "var(--bg-primary)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {!open && (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
      )}
      {open && (
        <FeedbackDialog
          onClose={() => setOpen(false)}
          unavailableReason={unavailableReason}
          onSubmit={async (msg) => {
            await new Promise((r) => setTimeout(r, delay));
            if (reject) {
              throw new Error("nope");
            }
            // eslint-disable-next-line no-console
            console.log("feedback:", msg);
          }}
        />
      )}
    </div>
  );
}

export const Default: Story = { render: () => <Shell /> };
export const SlowSend: Story = { render: () => <Shell delay={1500} /> };
export const SendError: Story = { render: () => <Shell reject /> };
export const Unavailable: Story = {
  render: () => (
    <Shell unavailableReason="Telemetry is turned off in Settings, so feedback can't be sent. Enable telemetry to send feedback." />
  ),
};
