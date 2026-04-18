import { useState } from "react";
import {
  CommitIcon,
  Icons,
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarItem,
  SidebarNav,
  SidebarNavGroup,
  SidebarScroll,
  SidebarSection,
} from "@argus/peacock";
import { useProjects } from "../../../hooks/useWorkspaces";
import {
  selectWorkspace,
  toggleProjectCollapsed,
  useSelectedWorkspaceId,
} from "../../../stores/workspaceStore";
import { OpenProjectDialog } from "../OpenProjectDialog";
import { ProjectSegment } from "../ProjectSegment";
import styles from "./WorkspaceSidebar.module.css";

export function WorkspaceSidebar() {
  const { projects, openProject, closeProject, error } = useProjects();
  const selectedId = useSelectedWorkspaceId();
  const [showOpenProject, setShowOpenProject] = useState(false);

  const sorted = [...projects].sort((a, b) => a.addedAt - b.addedAt);
  const totalWorkspaces = sorted.length;

  const handleAdd = () => setShowOpenProject(true);

  return (
    <SidebarNav
      framed
      className={styles.sidebar}
      style={{ width: "100%" }}
      aria-label="Argus sidebar"
    >
      <SidebarHeader
        brand={
          <>
            <Icons.ArgusLogo size={16} />
            <span>Argus</span>
          </>
        }
        actions={
          <>
            <SidebarHeaderAction title="New workspace" onClick={handleAdd}>
              <Icons.PlusIcon size={12} />
            </SidebarHeaderAction>
            <SidebarHeaderAction title="Open repo" onClick={handleAdd}>
              <Icons.FolderIcon size={12} />
            </SidebarHeaderAction>
          </>
        }
      />

      <SidebarNavGroup>
        <SidebarItem
          active={selectedId === null}
          leading={<Icons.HomeIcon size={12} />}
          count="—"
          onClick={() => selectWorkspace(null)}
        >
          Home
        </SidebarItem>
        <SidebarItem leading={<Icons.MergeIcon size={12} />} count={0} disabled>
          Review queue
        </SidebarItem>
        <SidebarItem leading={<CommitIcon size={12} />} count="∞" disabled>
          Activity
        </SidebarItem>
      </SidebarNavGroup>

      <SidebarScroll>
        {error && <p className={styles.errorMsg}>{error}</p>}

        <SidebarSection count={totalWorkspaces}>Workspaces</SidebarSection>
        {sorted.length === 0 ? (
          <p className={styles.empty}>No active workspaces.</p>
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
      </SidebarScroll>

      <SidebarFooter leading={<Icons.PlusIcon size={11} />} onClick={handleAdd}>
        Add repository
      </SidebarFooter>

      {showOpenProject && (
        <OpenProjectDialog
          onClose={() => setShowOpenProject(false)}
          onOpen={openProject}
        />
      )}
    </SidebarNav>
  );
}
