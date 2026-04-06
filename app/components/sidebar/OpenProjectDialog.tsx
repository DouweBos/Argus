import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";
import { useRecentProjectsStore } from "../../stores/recentProjectsStore";
import { CloseIcon, FolderIcon } from "../shared/Icons";
import styles from "./Dialog.module.css";
import projectStyles from "./OpenProjectDialog.module.css";

interface OpenProjectDialogProps {
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
}

export function OpenProjectDialog({ onOpen, onClose }: OpenProjectDialogProps) {
  const { projects, removeProject } = useRecentProjectsStore();

  const overlay = useOverlayDismiss(onClose);

  const handleBrowse = async () => {
    try {
      const selected = await window.stagehand.invoke<null | string>(
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

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-project-title"
      >
        <div className={styles.header}>
          <h2 id="open-project-title" className={styles.title}>
            Open Project
          </h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
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
                      onClick={() => handleSelectProject(project.path)}
                      title={project.path}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProject(project.path);
                      }}
                      title="Remove from recents"
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
    </div>
  );
}
