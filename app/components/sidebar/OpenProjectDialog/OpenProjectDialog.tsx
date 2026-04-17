import { createPortal } from "react-dom";
import { useOverlayDismiss } from "../../../hooks/useOverlayDismiss";
import {
  removeRecentProject,
  useRecentProjects,
} from "../../../stores/recentProjectsStore";
import { CloseIcon, FolderIcon } from "../../shared/Icons";
import styles from "../Dialog/Dialog.module.css";
import projectStyles from "./OpenProjectDialog.module.css";

interface OpenProjectDialogProps {
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
}

export function OpenProjectDialog({ onOpen, onClose }: OpenProjectDialogProps) {
  const projects = useRecentProjects();

  const overlay = useOverlayDismiss(onClose);

  const handleBrowse = async () => {
    try {
      const selected = await window.stagehand.invoke<string | null>(
        "show_open_dialog",
      );
      if (selected && typeof selected === "string") {
        onClose();
        await onOpen(selected);
      }
    } catch {
      // Dialog cancelled or failed — no-op
    }
  };

  const handleSelectProject = async (path: string) => {
    onClose();
    await onOpen(path);
  };

  return createPortal(
    <div className={styles.overlay} {...overlay}>
      <div
        aria-labelledby="open-project-title"
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="open-project-title">
            Open Project
          </h2>
          <button
            aria-label="Close"
            className={styles.closeBtn}
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className={projectStyles.body}>
          <button className={projectStyles.browseBtn} onClick={handleBrowse}>
            <FolderIcon />
            Browse...
          </button>

          {projects.length > 0 && (
            <div className={projectStyles.recentsSection}>
              <span className={projectStyles.recentsLabel}>
                Recent Projects
              </span>
              <ul className={projectStyles.recentsList}>
                {projects.map((project) => (
                  <li key={project.path} className={projectStyles.recentsItem}>
                    <button
                      className={projectStyles.recentsBtn}
                      title={project.path}
                      onClick={() => handleSelectProject(project.path)}
                    >
                      <FolderIcon />
                      <span className={projectStyles.recentsInfo}>
                        <span className={projectStyles.recentsName}>
                          {project.name}
                        </span>
                        <span className={projectStyles.recentsPath}>
                          {project.path}
                        </span>
                      </span>
                    </button>
                    <button
                      className={projectStyles.recentsRemove}
                      title="Remove from recents"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecentProject(project.path);
                      }}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
