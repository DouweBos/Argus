import { createPortal } from "react-dom";
import { Button, Icons } from "@argus/peacock";
import {
  removeRecentProject,
  useRecentProjects,
} from "../../../stores/recentProjectsStore";
import { Dialog } from "../../shared/Dialog";
import projectStyles from "./OpenProjectDialog.module.css";

interface OpenProjectDialogProps {
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
}

export function OpenProjectDialog({ onOpen, onClose }: OpenProjectDialogProps) {
  const projects = useRecentProjects();

  const handleBrowse = async () => {
    try {
      const selected = await window.argus.invoke<string | null>(
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
    <Dialog title="Open Project" titleId="open-project-title" onClose={onClose}>
      <div className={projectStyles.body}>
        <Button
          variant="ghost"
          className={projectStyles.browseBtn}
          leading={<Icons.FolderIcon size={13} />}
          onClick={handleBrowse}
        >
          Browse...
        </Button>

        {projects.length > 0 && (
          <div className={projectStyles.recentsSection}>
            <span className={projectStyles.recentsLabel}>Recent Projects</span>
            <ul className={projectStyles.recentsList}>
              {projects.map((project) => (
                <li key={project.path} className={projectStyles.recentsItem}>
                  <button
                    className={projectStyles.recentsBtn}
                    title={project.path}
                    onClick={() => handleSelectProject(project.path)}
                  >
                    <Icons.FolderIcon size={14} />
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
                    <Icons.CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>,
    document.body,
  );
}
