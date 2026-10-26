import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, DialogBody, Icons } from "@argus/peacock";
import { showOpenDirectoryDialog } from "../../../lib/ipc";
import { LOCAL_HOST_ID, type HostId } from "../../../lib/transport/hostId";
import { useFocusedConnection } from "../../../stores/connectionStore";
import { showCliImportDialog } from "../../../stores/dialogStore";
import {
  removeRecentProject,
  useRecentProjects,
} from "../../../stores/recentProjectsStore";
import { Dialog } from "../../shared/Dialog";
import { HostDirectoryPicker } from "../../shared/HostDirectoryPicker";
import projectStyles from "./OpenProjectDialog.module.css";

interface OpenProjectDialogProps {
  onClose: () => void;
  /** `hostId` is the machine the path belongs to — a host path is meaningless here. */
  onOpen: (path: string, hostId: HostId) => Promise<void>;
}

export function OpenProjectDialog({ onOpen, onClose }: OpenProjectDialogProps) {
  const allRecents = useRecentProjects();
  const connection = useFocusedConnection();
  // Only this machine's history: opening another machine's project would
  // follow that session to its host and quietly turn this tab into that one.
  const projects = useMemo(
    () => allRecents.filter((p) => p.hostId === connection.hostId),
    [allRecents, connection.hostId],
  );
  const [browsingHost, setBrowsingHost] = useState(false);

  const handleBrowse = async () => {
    // A native open dialog is host-only: attached elsewhere it would browse
    // this Mac's disk, which holds none of the host's repos.
    if (connection.mode === "remote") {
      setBrowsingHost(true);

      return;
    }
    try {
      const selected = await showOpenDirectoryDialog();
      if (selected) {
        onClose();
        // The native dialog only ever browses this Mac.
        await onOpen(selected, LOCAL_HOST_ID);
      }
    } catch {
      // Dialog cancelled or failed — no-op
    }
  };

  const pickHostPath = async (path: string) => {
    onClose();
    await onOpen(path, connection.hostId);
  };

  const handleSelectProject = async (path: string, hostId: HostId) => {
    onClose();
    await onOpen(path, hostId);
  };

  return createPortal(
    <Dialog title="Open Project" titleId="open-project-title" onClose={onClose}>
      <DialogBody>
        {browsingHost ? (
          <HostDirectoryPicker
            hostLabel={connection.label ?? "the host"}
            onCancel={() => setBrowsingHost(false)}
            onPick={(path) => {
              pickHostPath(path).catch(() => undefined);
            }}
          />
        ) : (
          <Button
            variant="ghost"
            className={projectStyles.browseBtn}
            leading={<Icons.FolderIcon size={13} />}
            onClick={handleBrowse}
          >
            Browse...
          </Button>
        )}

        {!browsingHost && (
          <Button
            variant="ghost"
            className={projectStyles.browseBtn}
            leading={<Icons.DownloadIcon size={13} />}
            onClick={() => {
              onClose();
              showCliImportDialog();
            }}
          >
            Import from Claude Code...
          </Button>
        )}

        {!browsingHost && projects.length > 0 && (
          <div className={projectStyles.recentsSection}>
            <span className={projectStyles.recentsLabel}>Recent Projects</span>
            <ul className={projectStyles.recentsList}>
              {projects.map((project) => (
                <li
                  key={`${project.hostId} ${project.path}`}
                  className={projectStyles.recentsItem}
                >
                  <button
                    className={projectStyles.recentsBtn}
                    title={project.path}
                    onClick={() =>
                      handleSelectProject(project.path, project.hostId)
                    }
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
      </DialogBody>
    </Dialog>,
    document.body,
  );
}
