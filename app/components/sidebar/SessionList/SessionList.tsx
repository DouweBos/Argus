import type { Session } from "../../../lib/types";
import { SessionCard } from "../SessionCard";
import styles from "./SessionList.module.css";

interface SessionListProps {
  deleteSession: (id: string) => Promise<void>;
  isLoading?: boolean;
  selectedId: string | null;
  selectSession: (id: string) => void;
  sessions: Session[];
}

export function SessionList({
  sessions,
  selectedId,
  selectSession,
  deleteSession,
  isLoading,
}: SessionListProps) {
  if (isLoading && sessions.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.spinner} />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No sessions yet.</p>
        <p className={styles.emptyHint}>Create a session to get started.</p>
      </div>
    );
  }

  // Sort repo_root sessions first.
  const sorted = [...sessions].sort((a, b) => {
    if (a.kind === "project_root" && b.kind !== "project_root") {
      return -1;
    }
    if (a.kind !== "project_root" && b.kind === "project_root") {
      return 1;
    }

    return 0;
  });

  return (
    <div aria-label="Sessions" className={styles.list} role="listbox">
      {sorted.map((session) => (
        <SessionCard
          key={session.id}
          isSelected={session.id === selectedId}
          session={session}
          onDelete={() => deleteSession(session.id)}
          onSelect={() => selectSession(session.id)}
        />
      ))}
    </div>
  );
}
