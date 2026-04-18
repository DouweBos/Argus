import type { HomeProject } from "../useHomeData";
import { Icons } from "@argus/peacock";
import { Dialog } from "../../../shared/Dialog";
import styles from "./NewWorkspacePicker.module.css";

export interface NewWorkspacePickerProps {
  onClose: () => void;
  onPick: (project: HomeProject) => void;
  projects: HomeProject[];
}

/** Compact picker shown when creating a workspace from Home and more than one project is available. */
export function NewWorkspacePicker({
  projects,
  onClose,
  onPick,
}: NewWorkspacePickerProps) {
  return (
    <Dialog
      onClose={onClose}
      title="New workspace"
      titleId="new-workspace-picker-title"
    >
      <div className={styles.container}>
        <p className={styles.caption}>
          Pick a repository for the new workspace.
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
                {p.workspaces.length} ws · {p.agents.length} agents
                <Icons.ArrowForwardIcon size={12} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
