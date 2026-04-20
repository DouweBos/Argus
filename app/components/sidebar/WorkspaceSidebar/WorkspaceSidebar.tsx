import { useState } from "react";
import {
  CommitIcon,
  Icons,
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarNav,
  SidebarNavGroup,
  SidebarScroll,
  SidebarSection,
} from "@argus/peacock";
import { useProjects } from "../../../hooks/useWorkspaces";
import { useActivityCount } from "../../../stores/activityStore";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useDevices } from "../../../stores/deviceStore";
import {
  useOrganizations,
  useOrganizationSync,
} from "../../../stores/organizationStore";
import { useReviewQueueCount } from "../../../stores/reviewQueueStore";
import { toggleProjectCollapsed } from "../../../stores/workspaceStore";
import { OpenProjectDialog } from "../OpenProjectDialog";
import { OrganizationSegment } from "../OrganizationSegment";
import { ProjectSegment } from "../ProjectSegment";
import { SidebarNavItem } from "./SidebarNavItem";
import styles from "./WorkspaceSidebar.module.css";

export function WorkspaceSidebar() {
  const { projects, openProject, closeProject } = useProjects();
  const devices = useDevices();
  const agentsRecord = useAgentsRecord();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const runningDevices = devices.filter((d) => d.online).length;
  const runningAgents = Object.values(agentsRecord).filter(
    (a) => a.status === "running",
  ).length;
  const reviewQueueCount = useReviewQueueCount();
  const activityCount = useActivityCount();
  useOrganizationSync();
  const organizations = useOrganizations();
  const organizationsCount = organizations.length;
  const sortedOrgs = [...organizations].sort(
    (a, b) => a.created_at - b.created_at,
  );

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
        <SidebarNavItem
          view="home"
          leading={<Icons.HomeIcon size={12} />}
          count="—"
        >
          Home
        </SidebarNavItem>
        <SidebarNavItem
          view="agents"
          leading={<Icons.AgentIcon size={12} />}
          count={runningAgents}
        >
          Agents
        </SidebarNavItem>
        <SidebarNavItem
          view="devices"
          leading={<Icons.SimulatorIcon size={12} />}
          count={runningDevices}
        >
          Devices
        </SidebarNavItem>
        <SidebarNavItem
          view="organizations"
          leading={<Icons.OrganizationIcon size={12} />}
          count={organizationsCount}
        >
          Organizations
        </SidebarNavItem>
        <SidebarNavItem
          view="review-queue"
          leading={<Icons.ReviewQueueIcon size={12} />}
          count={reviewQueueCount}
        >
          Review queue
        </SidebarNavItem>
        <SidebarNavItem
          view="activity"
          leading={<CommitIcon size={12} />}
          count={activityCount}
        >
          Activity
        </SidebarNavItem>
      </SidebarNavGroup>

      <SidebarScroll>
        <SidebarSection count={organizationsCount}>
          Organizations
        </SidebarSection>
        {sortedOrgs.length === 0 ? (
          <p className={styles.empty}>No organizations yet.</p>
        ) : (
          sortedOrgs.map((org) => (
            <OrganizationSegment key={org.id} org={org} />
          ))
        )}

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
