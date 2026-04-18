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
import { useActivityCount } from "../../../stores/activityStore";
import { useAgentsRecord } from "../../../stores/agentStore";
import { setCenterView, useCenterView } from "../../../stores/centerViewStore";
import { useDevices } from "../../../stores/deviceStore";
import { useReviewQueueCount } from "../../../stores/reviewQueueStore";
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
  const centerView = useCenterView();
  const devices = useDevices();
  const agentsRecord = useAgentsRecord();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const runningDevices = devices.filter((d) => d.online).length;
  const runningAgents = Object.values(agentsRecord).filter(
    (a) => a.status === "running",
  ).length;
  const reviewQueueCount = useReviewQueueCount();
  const activityCount = useActivityCount();

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
          active={selectedId === null && centerView === "home"}
          leading={<Icons.HomeIcon size={12} />}
          count="—"
          onClick={() => {
            setCenterView("home");
            selectWorkspace(null);
          }}
        >
          Home
        </SidebarItem>
        <SidebarItem
          active={selectedId === null && centerView === "agents"}
          leading={<Icons.AgentIcon size={12} />}
          count={runningAgents}
          onClick={() => {
            setCenterView("agents");
            selectWorkspace(null);
          }}
        >
          Agents
        </SidebarItem>
        <SidebarItem
          active={selectedId === null && centerView === "devices"}
          leading={<Icons.SimulatorIcon size={12} />}
          count={runningDevices}
          onClick={() => {
            setCenterView("devices");
            selectWorkspace(null);
          }}
        >
          Devices
        </SidebarItem>
        <SidebarItem
          active={selectedId === null && centerView === "review-queue"}
          leading={<Icons.MergeIcon size={12} />}
          count={reviewQueueCount}
          onClick={() => {
            setCenterView("review-queue");
            selectWorkspace(null);
          }}
        >
          Review queue
        </SidebarItem>
        <SidebarItem
          active={selectedId === null && centerView === "activity"}
          leading={<CommitIcon size={12} />}
          count={activityCount}
          onClick={() => {
            setCenterView("activity");
            selectWorkspace(null);
          }}
        >
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
