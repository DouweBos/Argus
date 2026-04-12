import { useState } from "react";
import { useProjects } from "../../../hooks/useWorkspaces";
import {
  selectWorkspace,
  toggleProjectCollapsed,
  useSelectedWorkspaceId,
} from "../../../stores/workspaceStore";
import { HomeIcon, PlusIcon } from "../../shared/Icons";
import { OpenProjectDialog } from "../OpenProjectDialog";
import { ProjectSegment } from "../ProjectSegment";
import styles from "./WorkspaceSidebar.module.css";

export function WorkspaceSidebar() {
  const { projects, openProject, closeProject, error } = useProjects();
  const selectedId = useSelectedWorkspaceId();
  const [showOpenProject, setShowOpenProject] = useState(false);

  // Sort by addedAt ascending (oldest first, newest at bottom)
  const sorted = [...projects].sort((a, b) => a.addedAt - b.addedAt);

  return (
    <div className={styles.sidebar}>
      {error && <p className={styles.errorMsg}>{error}</p>}

      {/* Home header */}
      <div className={styles.homeRow}>
        <button
          className={`${styles.homeHeader} ${selectedId === null ? styles.homeHeaderActive : ""}`}
          title="Home"
          type="button"
          onClick={() => selectWorkspace(null)}
        >
          <HomeIcon />
          <span className={styles.homeLabel}>Home</span>
        </button>
      </div>

      {/* Project segments */}
      <div className={styles.projectList}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>No projects open.</p>
            <p className={styles.emptyHint}>Add a repository to get started.</p>
          </div>
        ) : (
          sorted.map((project) => (
            <ProjectSegment
              key={project.repoRoot}
              isCollapsed={project.isCollapsed}
              repoRoot={project.repoRoot}
              onClose={() => closeProject(project.repoRoot)}
              onToggleCollapsed={() => toggleProjectCollapsed(project.repoRoot)}
            />
          ))
        )}
      </div>

      {/* Add repository at the bottom */}
      <div className={styles.bottomBar}>
        <button
          className={styles.addProjectBtn}
          onClick={() => setShowOpenProject(true)}
        >
          <PlusIcon size={14} />
          Add repository
        </button>
      </div>

      {showOpenProject && (
        <OpenProjectDialog
          onClose={() => setShowOpenProject(false)}
          onOpen={openProject}
        />
      )}
    </div>
  );
}
