import { useMemo, useState } from "react";
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
import { useRouteHostId } from "../../../lib/routeHooks";
import { LOCAL_HOST_ID, isLocalHost } from "../../../lib/transport/hostId";
import { useAgentsRecord } from "../../../stores/agentStore";
import {
  useAutomations,
  useUnreadReportCount,
} from "../../../stores/automationStore";
import { useHostConnections } from "../../../stores/connectionStore";
import { useDevices } from "../../../stores/deviceStore";
import { usePendingProposals } from "../../../stores/proposalStore";
import {
  useAwaitingMyReviewCount,
  usePrList,
} from "../../../stores/pullRequestStore";
import { reorderOpenProjects } from "../../../stores/recentProjectsStore";
import { projectKey } from "../../../stores/sessionStore";
import {
  reorderProjects,
  toggleProjectCollapsed,
} from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { useTotalRunningTerminals } from "../../../stores/terminalStore";
import { OpenProjectDialog } from "../OpenProjectDialog";
import { ProjectSegment } from "../ProjectSegment";
import { ScratchPadSection } from "../ScratchPadSection";
import styles from "./SessionSidebar.module.css";
import { SidebarNavItem } from "./SidebarNavItem";

export function SessionSidebar() {
  const { projects: allProjects, openProject, closeProject } = useProjects();
  // This Mac's tab is the combined view, with every project badged by machine.
  // A paired machine's tab shows only its own — its projects, its sessions.
  const routeHostId = useRouteHostId();
  const projects = useMemo(
    () =>
      isLocalHost(routeHostId)
        ? allProjects
        : allProjects.filter((p) => p.hostId === routeHostId),
    [allProjects, routeHostId],
  );
  const devices = useDevices();
  const agentsRecord = useAgentsRecord();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const runningDevices = devices.filter((d) => d.online).length;
  const runningRuntimes = useTotalRunningTerminals();
  const runningAgents = Object.values(agentsRecord).filter(
    (a) => a.status === "running",
  ).length;
  const automations = useAutomations();
  const pendingProposals = usePendingProposals().length;
  const enabledAutomations = automations.filter((a) => a.enabled).length;
  const unreadReports = useUnreadReportCount();
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
  const totalProjects = projects.length;

  // Projects carry the machine they live on: several hosts are attached at
  // once, and `~/Work/app` can exist on more than one of them.
  const connections = useHostConnections();
  const hostLabels = new Map(connections.map((c) => [c.hostId, c.label]));
  // Detached counts as offline: the projects stay on screen read-only, so the
  // badge has to say nothing can be run on them.
  const hostOffline = (hostId: string): boolean =>
    hostId !== LOCAL_HOST_ID &&
    (connections.find((c) => c.hostId === hostId)?.state ?? "offline") ===
      "offline";

  const [dragRoot, setDragRoot] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    position: "after" | "before";
    root: string;
  } | null>(null);

  const handleAdd = () => setShowOpenProject(true);

  // Keyed by `projectKey()` — two hosts may hold a repo at the same path.
  const handleDragStart =
    (key: string) => (e: React.DragEvent<HTMLDivElement>) => {
      setDragRoot(key);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
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
          view="inbox"
          leading={<Icons.EnvelopeIcon size={12} />}
          count={pendingProposals}
          attention={unreadReports > 0}
        >
          Inbox
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
          view="automations"
          leading={<Icons.ClockIcon size={12} />}
          count={enabledAutomations}
        >
          Automations
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
        <SidebarSection count={totalProjects}>Projects</SidebarSection>
        {projects.length === 0 ? (
          <p className={styles.empty}>No active projects.</p>
        ) : (
          projects.map((project) => {
            const key = projectKey(project);
            const isDragging = dragRoot === key;
            const isTarget = dropTarget?.root === key;
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
                key={key}
                className={slotClass}
                draggable
                onDragStart={handleDragStart(key)}
                onDragOver={handleDragOver(key)}
                onDrop={handleDrop(key)}
                onDragEnd={handleDragEnd}
              >
                <ProjectSegment
                  hostId={project.hostId}
                  hostLabel={
                    project.hostId === LOCAL_HOST_ID
                      ? null
                      : (hostLabels.get(project.hostId) ?? project.hostId)
                  }
                  hostOffline={hostOffline(project.hostId)}
                  isCollapsed={project.isCollapsed}
                  repoRoot={project.repoRoot}
                  onClose={() => closeProject(project.repoRoot, project.hostId)}
                  onToggleCollapsed={() =>
                    toggleProjectCollapsed(project.repoRoot, project.hostId)
                  }
                />
              </div>
            );
          })
        )}
        <ScratchPadSection />
      </SidebarScroll>

      <SidebarFooter leading={<Icons.PlusIcon size={11} />} onClick={handleAdd}>
        Add repository
      </SidebarFooter>

      {showOpenProject && (
        <OpenProjectDialog
          onClose={() => setShowOpenProject(false)}
          onOpen={(path, hostId) => openProject(path, { hostId })}
        />
      )}
    </SidebarNav>
  );
}
