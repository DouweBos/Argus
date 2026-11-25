/**
 * A sidebar session's right-click menu: its workflow status and note, as the
 * Mac sidebar's and the phone's session menus offer.
 */

import { type MouseEvent, type ReactNode, useState } from "react";
import { effectiveWorkflowStatus, setWorkflowStatus } from "@argus/client-core";
import {
  Button,
  ContextMenu,
  type ContextMenuItem,
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
  SESSION_WORKFLOW_STATUS_LABELS,
  SESSION_WORKFLOW_STATUSES,
  SessionStatusIcon,
} from "@argus/peacock";
import type { RemoteSession, SessionWorkflowStatus } from "../../lib/protocol";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";

export function sessionTriageItems(
  session: RemoteSession,
  set: (status: SessionWorkflowStatus | null) => void,
  editNote: () => void,
): ContextMenuItem[] {
  const current = effectiveWorkflowStatus(session);
  const done = current === "done";
  const prClosed =
    session.pull_request?.state === "merged" ||
    session.pull_request?.state === "closed";

  return [
    done
      ? {
          label: "Move back to active",
          // A merged PR would make it done again; only a set status holds it open.
          onClick: () => set(prClosed ? "in_progress" : null),
        }
      : { label: "Mark as done", onClick: () => set("done") },
    {
      label: "Status",
      trailing: current ? SESSION_WORKFLOW_STATUS_LABELS[current] : undefined,
      children: [
        ...SESSION_WORKFLOW_STATUSES.map(
          (status): ContextMenuItem => ({
            icon: <SessionStatusIcon status={status} />,
            label: SESSION_WORKFLOW_STATUS_LABELS[status],
            selected: status === current,
            onClick: () => set(status),
          }),
        ),
        ...(setWorkflowStatus(session)
          ? [
              { separator: true } as const,
              {
                label: session.pull_request
                  ? "Follow pull request"
                  : "Clear status",
                onClick: () => set(null),
              },
            ]
          : []),
      ],
    },
    {
      label: session.status_note ? "Edit note" : "Add note",
      onClick: editNote,
    },
  ];
}

/** Right-click handler and what to render for it: the menu, or the note dialog. */
export function useSessionTriageMenu(session: RemoteSession): {
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  overlay: ReactNode;
} {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const setSessionStatus = useProjectsStore((s) => s.setSessionStatus);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const triageable =
    hasControl && (session.kind === "worktree" || session.kind === "scratch_pad");
  if (!triageable) {
    return { overlay: null };
  }
  const set = (status: SessionWorkflowStatus | null, note?: string) => {
    setSessionStatus(session, status, note).catch(() => {});
  };

  return {
    onContextMenu: (event) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
    },
    overlay: (
      <>
        {menu && (
          <ContextMenu
            items={sessionTriageItems(session, set, () => setEditingNote(true))}
            position={menu}
            onClose={() => setMenu(null)}
          />
        )}
        {editingNote && (
          <NoteDialog
            initial={session.status_note ?? ""}
            onCancel={() => setEditingNote(false)}
            onSave={(note) => {
              setEditingNote(false);
              set(setWorkflowStatus(session), note);
            }}
          />
        )}
      </>
    ),
  };
}

function NoteDialog({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(initial);

  return (
    <Dialog
      title={initial ? "Edit note" : "Add note"}
      titleId="aw-session-note"
      onClose={onCancel}
    >
      <DialogBody>
        <Input
          autoFocus
          aria-label="Note"
          placeholder="Waiting on CI"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(note.trim());
            }
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onSave(note.trim())}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
