import type { ReactNode } from "react";
import { useDraggable } from "@argus/peacock";

export interface CommitChangesetFileRowProps {
  children: ReactNode;
  className: string;
  filePath: string;
  onClick: () => void;
  /** Commit hash this file belongs to. When the row is dropped on the working
   *  copy, this ref is used to restore the file. Empty string disables drag. */
  sourceRef: string;
}

/**
 * Changeset file row for a selected commit. Draggable so the working-copy
 * panel can pick up the file and restore it from this commit.
 */
export function CommitChangesetFileRow({
  children,
  className,
  filePath,
  onClick,
  sourceRef,
}: CommitChangesetFileRowProps) {
  const drag = useDraggable({
    kind: "file",
    paths: [filePath],
    sourceRef: sourceRef || undefined,
  });

  return (
    <button {...drag} className={className} onClick={onClick}>
      {children}
    </button>
  );
}
