import { useState } from "react";
import {
  Icons,
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarNav,
  SidebarNavGroup,
  SidebarScroll,
  SidebarSection,
  StatusDot,
} from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useDevices } from "../../../stores/deviceStore";
import {
  useOrganizations,
  useOrganizationSync,
} from "../../../stores/organizationStore";
import {
  useAwaitingMyReviewCount,
  usePrList,
} from "../../../stores/pullRequestStore";
import { reorderOpenProjects } from "../../../stores/recentProjectsStore";
import {
  reorderProjects,
  toggleProjectCollapsed,
} from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { useTotalRunningTerminals } from "../../../stores/terminalStore";
import { OpenProjectDialog } from "../OpenProjectDialog";
import { OrganizationSegment } from "../OrganizationSegment";
import { ProjectSegment } from "../ProjectSegment";
import styles from "./SessionSidebar.module.css";
import { SidebarNavItem } from "./SidebarNavItem";

export function SessionSidebar() {
  const { projects, openProject, closeProject } = useProjects();
  const devices = useDevices();
  const agentsRecord = useAgentsRecord();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const runningDevices = devices.filter((d) => d.online).length;
  const runningRuntimes = useTotalRunningTerminals();
  const runningAgents = Object.values(agentsRecord).filter(
    (a) => a.status === "running",
  ).length;
  const awaitingMyReviewCount = useAwaitingMyReviewCount();
  const prList = usePrList();
  // Show a spinner until the first fetch has landed; swapping to `0`
  // before we have data would imply "no reviews waiting" when really
  // we just haven't asked GitHub yet.
  const prNavCount =
    prList.data === null ? (
      <StatusDot
        tone="currentColor"
        pulse
        aria-label="Fetching pull requests"
      />
    ) : (
      awaitingMyReviewCount
    );
  useOrganizationSync();
  const organizations = useOrganizations();
  const organizationsCount = organizations.length;
  const sortedOrgs = [...organizations].sort(
    (a, b) => a.created_at - b.created_at,
  );

  const totalProjects = projects.length;

  const [dragRoot, setDragRoot] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    position: "after" | "before";
    root: string;
  } | null>(null);

  const handleAdd = () => setShowOpenProject(true);

  const handleDragStart =
    (repoRoot: string) => (e: React.DragEvent<HTMLDivElement>) => {
      setDragRoot(repoRoot);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", repoRoot);
    };

  const handleDragOver =
    (repoRoot: string) => (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragRoot || dragRoot === repoRoot) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const position =
        e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      setDropTarget((prev) =>
        prev?.root === repoRoot && prev.position === position
          ? prev
          : { root: repoRoot, position },
      );
    };

  const handleDrop =
    (repoRoot: string) => (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const from = dragRoot;
      const target = dropTarget;
      setDragRoot(null);
      setDropTarget(null);
      if (!from || from === repoRoot || !target) {
        return;
      }
      reorderProjects(from, target.root, target.position);
      reorderOpenProjects(from, target.root, target.position);
    };

  const handleDragEnd = () => {
    setDragRoot(null);
    setDropTarget(null);
  };

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
            <SidebarHeaderAction title="New project" onClick={handleAdd}>
              <Icons.PlusIcon size={12} />
            </SidebarHeaderAction>
            <SidebarHeaderAction
              title="Settings (⌘,)"
              onClick={() => showSettingsDialog()}
            >
              <Icons.GearIcon size={12} />
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
          view="runtimes"
          leading={<Icons.TerminalIcon size={12} />}
          count={runningRuntimes}
        >
          Runtimes
        </SidebarNavItem>
        <SidebarNavItem
          view="organizations"
          leading={<Icons.OrganizationIcon size={12} />}
          count={organizationsCount}
        >
          Organizations
        </SidebarNavItem>
        <SidebarNavItem
          view="pull-requests"
          leading={<Icons.MergeIcon size={12} />}
          count={prNavCount}
        >
          Pull requests
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

        <SidebarSection count={totalProjects}>Projects</SidebarSection>
        {projects.length === 0 ? (
          <p className={styles.empty}>No active projects.</p>
        ) : (
          projects.map((project) => {
            const isDragging = dragRoot === project.repoRoot;
            const isTarget = dropTarget?.root === project.repoRoot;
            const slotClass = [
              styles.projectSlot,
              isDragging ? styles.dragging : "",
              isTarget && dropTarget?.position === "before"
                ? styles.dropBefore
                : "",
              isTarget && dropTarget?.position === "after"
                ? styles.dropAfter
                : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={project.repoRoot}
                className={slotClass}
                draggable
                onDragStart={handleDragStart(project.repoRoot)}
                onDragOver={handleDragOver(project.repoRoot)}
                onDrop={handleDrop(project.repoRoot)}
                onDragEnd={handleDragEnd}
              >
                <ProjectSegment
                  isCollapsed={project.isCollapsed}
                  repoRoot={project.repoRoot}
                  onClose={() => closeProject(project.repoRoot)}
                  onToggleCollapsed={() =>
                    toggleProjectCollapsed(project.repoRoot)
                  }
                />
              </div>
            );
          })
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
