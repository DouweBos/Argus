import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "./Dialog";
import { DialogBody } from "./DialogBody";
import { DialogFooter } from "./DialogFooter";

const meta: Meta<typeof Dialog> = {
  title: "Components/Dialog",
  component: Dialog,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

function Stage({ children }: { children: React.ReactNode }) {
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
      {children}
    </div>
  );
}

function DialogDemo({ titleText = "Confirm action" }: { titleText?: string }) {
  const [open, setOpen] = useState(true);

  return (
    <Stage>
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
          <DialogBody>
            Dialog body content goes here. Children can be any React node — a
            form, a scrollable list, or static copy.
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary">Confirm</Button>
          </DialogFooter>
        </Dialog>
      )}
    </Stage>
  );
}

export const Default: Story = {
  render: () => <DialogDemo />,
};

export const LongTitle: Story = {
  render: () => <DialogDemo titleText="A dialog with a longer title string" />,
};

export const Medium: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <Stage>
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            size="medium"
            title="Describe an automation"
            titleId="demo-dialog-medium"
          >
            <DialogBody>
              <p style={{ margin: 0 }}>
                Medium is the size for multi-field forms, pickers and config
                panels. The body inset matches the header, so the first field
                lines up with the title.
              </p>
              <textarea
                rows={4}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary">Save</Button>
            </DialogFooter>
          </Dialog>
        )}
      </Stage>
    );
  },
};

/** The body scrolls; header and footer stay pinned. */
export const ScrollingBody: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <Stage>
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            size="medium"
            title="Long body"
            titleId="demo-dialog-scroll"
          >
            <DialogBody>
              {Array.from({ length: 40 }, (_, i) => (
                <p key={i} style={{ margin: 0 }}>
                  Row {i + 1} — the body owns the scroll, so the footer never
                  drifts out of reach.
                </p>
              ))}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </Dialog>
        )}
      </Stage>
    );
  },
};

/** `leading` puts a destructive action or helper text on the left. */
export const FooterWithLeading: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <Stage>
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            title="Edit automation"
            titleId="demo-dialog-leading"
          >
            <DialogBody>Change the schedule, or delete it entirely.</DialogBody>
            <DialogFooter leading={<Button variant="danger">Delete</Button>}>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary">Save</Button>
            </DialogFooter>
          </Dialog>
        )}
      </Stage>
    );
  },
};

/** `flush` drops the padding for workspace shells whose panes pad themselves. */
export const FullSize: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <div
        style={{
          padding: 24,
          background: "var(--bg-primary)",
          minHeight: "100vh",
        }}
      >
        {!open && (
          <Button variant="primary" onClick={() => setOpen(true)}>
            Open full dialog
          </Button>
        )}
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            size="full"
            title="Full-size dialog"
            titleId="demo-dialog-full"
          >
            <DialogBody>
              Workspace-style modal. Fills the viewport (minus a small margin),
              pins to the max height regardless of how short the body is, and
              caps the width at a readable reading measure on huge displays.
              Good for PR detail, diff viewers, long forms — anything where
              layout stability matters and the dialog is essentially a page.
            </DialogBody>
          </Dialog>
        )}
      </div>
    );
  },
};

export const Flush: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <div
        style={{
          padding: 24,
          background: "var(--bg-primary)",
          minHeight: "100vh",
        }}
      >
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            size="full"
            title="Flush body"
            titleId="demo-dialog-flush"
          >
            <DialogBody flush>
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  padding: 32,
                  background: "var(--surface-1)",
                }}
              >
                A flush body has no padding of its own — the pane inside owns
                its spacing. Use it for split shells and embedded viewers.
              </div>
            </DialogBody>
          </Dialog>
        )}
      </div>
    );
  },
};

export const WithTitleExtra: Story = {
  render: () => {
    const [open, setOpen] = useState(true);

    return (
      <Stage>
        {open && (
          <Dialog
            onClose={() => setOpen(false)}
            title="Create session"
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
            <DialogBody>Dialog with subtitle in the header area.</DialogBody>
          </Dialog>
        )}
      </Stage>
    );
  },
};
