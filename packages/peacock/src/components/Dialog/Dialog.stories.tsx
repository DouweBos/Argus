import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "./Dialog";

const meta: Meta<typeof Dialog> = {
  title: "Components/Dialog",
  component: Dialog,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

function DialogDemo({ titleText = "Confirm action" }: { titleText?: string }) {
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        padding: 24,
        background: "var(--bg-primary)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {!open && (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
      )}
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          title={titleText}
          titleId="demo-dialog"
        >
          <div
            style={{
              padding: "16px 20px 20px",
              color: "var(--text-secondary)",
              fontSize: 13,
            }}
          >
            Dialog body content goes here. Children can be any React node — a
            form, a scrollable list, or static copy.
          </div>
        </Dialog>
      )}
    </div>
  );
}

export const Default: Story = {
  render: () => <DialogDemo />,
};

export const LongTitle: Story = {
  render: () => <DialogDemo titleText="A dialog with a longer title string" />,
};

export const WithTitleExtra: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <div
        style={{
          padding: 24,
          background: "var(--bg-primary)",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            title="Create workspace"
            titleExtra={
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginLeft: 8,
                  fontWeight: 400,
                }}
              >
                my-repo
              </span>
            }
            titleId="demo-dialog-extra"
          >
            <div
              style={{
                padding: "16px 20px 20px",
                color: "var(--text-secondary)",
                fontSize: 13,
              }}
            >
              Dialog with subtitle in the header area.
            </div>
          </Dialog>
        )}
      </div>
    );
  },
};
