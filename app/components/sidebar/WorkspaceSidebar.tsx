import { useState } from "react";
import { useProjects } from "../../hooks/useWorkspaces";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { ProjectSegment } from "./ProjectSegment";
import { OpenProjectDialog } from "./OpenProjectDialog";
import { PlusIcon, HomeIcon } from "../shared/Icons";
import styles from "./WorkspaceSidebar.module.css";

export function WorkspaceSidebar() {
  const { projects, openProject, closeProject, error } = useProjects();
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const toggleCollapsed = useWorkspaceStore((s) => s.toggleProjectCollapsed);
  const [showOpenProject, setShowOpenProject] = useState(false);

  // Sort by addedAt ascending (oldest first, newest at bottom)
  const sorted = [...projects].sort((a, b) => a.addedAt - b.addedAt);

  return (
    <div className={styles.sidebar}>
      {error && <p className={styles.errorMsg}>{error}</p>}

      {/* Home header */}
      <button
        type="button"
        className={`${styles.homeHeader} ${selectedId === null ? styles.homeHeaderActive : ""}`}
        onClick={() => selectWorkspace(null)}
        title="Home"
      >
        <HomeIcon />
        <span className={styles.homeLabel}>Home</span>
      </button>

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
              repoRoot={project.repoRoot}
              isCollapsed={project.isCollapsed}
              onToggleCollapsed={() => toggleCollapsed(project.repoRoot)}
              onClose={() => closeProject(project.repoRoot)}
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
          onOpen={openProject}
          onClose={() => setShowOpenProject(false)}
        />
      )}
    </div>
  );
}
