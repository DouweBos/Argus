import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/Button";
import { ConfirmDialog } from "./ConfirmDialog";

const meta: Meta<typeof ConfirmDialog> = {
  title: "Components/ConfirmDialog",
  component: ConfirmDialog,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

function Shell({
  destructive = false,
  title = "Confirm action",
  body = "Are you sure you want to proceed?",
  confirmLabel = "Confirm",
}: {
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
  title?: string;
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
        <ConfirmDialog
          title={title}
          titleId="confirm-demo"
          destructive={destructive}
          confirmLabel={confirmLabel}
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        >
          {body}
        </ConfirmDialog>
      )}
    </div>
  );
}

export const Default: Story = { render: () => <Shell /> };

export const Destructive: Story = {
  render: () => (
    <Shell
      destructive
      title="Stop agent?"
      body="This agent is still running. Stop it and close anyway?"
      confirmLabel="Stop & close"
    />
  ),
};

export const QuitWithRunningAgents: Story = {
  render: () => (
    <Shell
      destructive
      title="Quit Argus?"
      body="2 agents are still running. Quitting will stop them."
      confirmLabel="Quit anyway"
    />
  ),
};
