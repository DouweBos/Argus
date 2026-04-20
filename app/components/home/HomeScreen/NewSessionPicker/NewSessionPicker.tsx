import type { HomeProject } from "../useHomeData";
import { Icons } from "@argus/peacock";
import { Dialog } from "../../../shared/Dialog";
import styles from "./NewSessionPicker.module.css";

export interface NewSessionPickerProps {
  onClose: () => void;
  onPick: (project: HomeProject) => void;
  projects: HomeProject[];
}

/** Compact picker shown when creating a session from Home and more than one project is available. */
export function NewSessionPicker({
  projects,
  onClose,
  onPick,
}: NewSessionPickerProps) {
  return (
    <Dialog
      onClose={onClose}
      title="New session"
      titleId="new-session-picker-title"
    >
      <div className={styles.container}>
        <p className={styles.caption}>
          Pick a repository for the new session.
        </p>
        <div className={styles.list}>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.item}
              onClick={() => onPick(p)}
            >
              <span
                className={styles.swatch}
                style={{ background: p.accent }}
                aria-hidden
              />
              <span className={styles.body}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.path}>{p.path}</span>
              </span>
              <span className={styles.meta}>
                {p.sessions.length} ws · {p.agents.length} agents
                <Icons.ArrowForwardIcon size={12} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
