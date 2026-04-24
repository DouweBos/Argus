import type { DependencyStatus, OrgTask } from "../../../lib/types";
import { useEffect, useState } from "react";
import {
  AgentRow,
  Banner,
  Button,
  EmptyHome,
  Icons,
  Kbd,
  OrganizationCard,
  ProjectCard,
} from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import { checkDependencies } from "../../../lib/ipc";
import { setActiveAgent, useAgentsRecord } from "../../../stores/agentStore";
import {
  openOrganization,
  setCenterView,
} from "../../../stores/centerViewStore";
import { useDevicePoller } from "../../../stores/deviceStore";
import {
  showCreateOrganizationDialog,
  showCreateSessionDialog,
  showOpenProjectDialog,
  triggerNewSession,
} from "../../../stores/dialogStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import {
  taskLiveStatus,
  useOrgTasks,
  useOrgTaskSync,
} from "../../../stores/orgTaskStore";
import {
  useOrganizations,
  useOrganizationSync,
} from "../../../stores/organizationStore";
import { removeRecentProject } from "../../../stores/recentProjectsStore";
import { selectSession } from "../../../stores/sessionStore";
import { OrganizationDialogHost } from "../OrganizationDialog/OrganizationDialog";
import styles from "./HomeScreen.module.css";
import { HOME_SHORTCUTS } from "./homeContent";
import { useHomeData, type HomeProject } from "./useHomeData";

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function OrganizationCardWithTasks({
  org,
  tasks,
  onOpen,
}: {
  onOpen: () => void;
  org: ReturnType<typeof useOrganizations>[number];
  tasks: OrgTask[];
}) {
  const agents = useAgentsRecord();

  const taskAgents = tasks.map((t) => ({
    task: t,
    pillStatus: taskLiveStatus(
      t,
      t.host_agent_id ? agents[t.host_agent_id] : undefined,
    ),
  }));

  const liveRunning = taskAgents.filter((ta) => ta.pillStatus === "running");
  const visible = taskAgents.filter(
    (ta) => ta.pillStatus === "running" || ta.pillStatus === "pending",
  );

  const [expanded, setExpanded] = useState(visible.length > 0);

  let toggleLabel: string;
  if (liveRunning.length > 0) {
    toggleLabel = `${liveRunning.length} running task${liveRunning.length === 1 ? "" : "s"}`;
  } else if (tasks.length > 0) {
    toggleLabel = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  } else {
    toggleLabel = "No tasks yet";
  }

  return (
    <OrganizationCard
      name={org.name}
      description={org.description || undefined}
      accent={org.accent}
      members={org.members.map((m) => basename(m.repo_root))}
      taskCount={tasks.length}
      runningCount={liveRunning.length}
      collapsible
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      toggleLabel={toggleLabel}
      onClick={onOpen}
      style={{ cursor: "pointer" }}
    >
      {visible.length === 0 ? (
        <div
          style={{
            padding: "10px 12px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          No running tasks.
        </div>
      ) : (
        visible.map(({ task: t, pillStatus }) => (
          <ProjectCard
            key={t.id}
            name={t.title}
            accent={org.accent}
            icon={<Icons.TaskIcon size={14} />}
            agents={[{ status: pillStatus }]}
            lastOpened={formatTimeAgo(t.created_at)}
            onClick={(e) => {
              e.stopPropagation();
              if (t.host_session_id) {
                selectSession(t.host_session_id);
              }
            }}
          />
        ))
      )}
    </OrganizationCard>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);

  return `${day}d ago`;
}

function agentMeta(status: string): string {
  if (status === "running") {
    return "running";
  }
  if (status === "error") {
    return "blocked";
  }
  if (status === "pending") {
    return "waiting";
  }

  return "idle";
}

export function HomeScreen() {
  useDevicePoller(5000);
  useOrganizationSync();
  useOrgTaskSync();
  const data = useHomeData();
  const orgs = useOrganizations();
  const tasks = useOrgTasks();
  const { openProject } = useProjects();
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [missingDeps, setMissingDeps] = useState<DependencyStatus[]>([]);

  useEffect(() => {
    checkDependencies()
      .then((report) =>
        setMissingDeps(report.dependencies.filter((d) => !d.installed)),
      )
      .catch(() => setMissingDeps([]));
  }, []);

  const missingRequired = missingDeps.filter((d) => d.severity === "required");
  const missingOptional = missingDeps.filter((d) => d.severity === "optional");

  const handleOpenProject = async (p: HomeProject) => {
    setOpenError(null);
    setOpeningPath(p.path);
    try {
      await openProject(p.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
      removeRecentProject(p.path);
    } finally {
      setOpeningPath(null);
    }
  };

  const handleOpenSession = async (
    sessionId: string,
    repoPath: string,
    agentId?: string,
  ) => {
    try {
      await openProject(repoPath, { autoSelect: false });
      selectSession(sessionId);
      if (agentId) {
        setActiveAgent(sessionId, agentId);
        setActiveCenterView("agents");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
    }
  };

  const handleAddRepository = () => showOpenProjectDialog();
  const handleNewSession = () => triggerNewSession();

  const openDevices = () => {
    setCenterView("devices");
  };

  const openAgents = () => {
    setCenterView("agents");
  };

  const { projects, activeAgents, devices, formatLastOpened } = data;
  const runningDevices = devices.filter((d) => d.online);
  const isEmpty = projects.length === 0;

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {missingRequired.map((dep) => (
          <Banner key={dep.id} tone="error">
            <strong>{dep.name}</strong> not found. {dep.purpose} {dep.hint}
          </Banner>
        ))}
        {missingOptional.map((dep) => (
          <Banner key={dep.id} tone="warning">
            <strong>{dep.name}</strong> not found. {dep.purpose} {dep.hint}
          </Banner>
        ))}
        {openError && (
          <Banner tone="error">
            {openError}
            {openingPath && `  (${openingPath})`}
          </Banner>
        )}

        <div className={styles.body}>
          {isEmpty ? (
            <EmptyHome
              actions={
                <Button
                  variant="primary"
                  leading={<Icons.FolderIcon size={13} />}
                  onClick={handleAddRepository}
                >
                  Add repository
                </Button>
              }
              shortcuts={HOME_SHORTCUTS.slice(0, 3).map((s) => (
                <span
                  key={s.label}
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  <Kbd keys={s.keys} />
                  {s.label}
                </span>
              ))}
            />
          ) : (
            <div className={styles.wrap}>
              <div className={styles.hero}>
                <div className={styles.brandMark}>
                  <Icons.ArgusLogo size={28} />
                  <h1 className={styles.title}>Argus</h1>
                </div>
                <div className={styles.heroSpacer} />
                <div className={styles.ctas}>
                  <Button
                    variant="ghost"
                    leading={<Icons.FolderIcon size={12} />}
                    onClick={handleAddRepository}
                  >
                    Open repo
                  </Button>
                  <Button
                    variant="primary"
                    leading={<Icons.PlusIcon size={12} />}
                    onClick={handleNewSession}
                  >
                    New session
                  </Button>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.eyebrow}>Organizations</span>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={showCreateOrganizationDialog}
                  >
                    New organization
                  </button>
                </div>
                {orgs.length === 0 ? (
                  <div className={styles.emptyCell}>
                    Group a backend + frontend + mobile repo into one product.
                    Agents inherit the organization&apos;s system prompt.
                  </div>
                ) : (
                  <div className={styles.projGrid}>
                    {orgs.map((org) => (
                      <OrganizationCardWithTasks
                        key={org.id}
                        org={org}
                        tasks={tasks.filter(
                          (t) => t.organization_id === org.id,
                        )}
                        onOpen={() => openOrganization(org.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.section}>
                <span className={styles.eyebrow}>Recent projects</span>
                {projects.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No recent projects. Open a repo to get started.
                  </div>
                ) : (
                  <div className={styles.projGrid}>
                    {projects.map((p) => (
                      <ProjectCard
                        key={p.id}
                        name={p.name}
                        path={p.path}
                        accent={p.accent}
                        agents={p.agents.map((a) => ({ status: a.status }))}
                        lastOpened={formatLastOpened(p.lastOpened)}
                        onClick={() => {
                          handleOpenProject(p).catch(() => {});
                        }}
                        onNewSession={() => {
                          showCreateSessionDialog(p.path);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (
                            window.confirm(
                              `Remove ${p.name} from recent projects?`,
                            )
                          ) {
                            removeRecentProject(p.path);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.twoCol}>
                <div className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.eyebrow}>Active agents</span>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={openAgents}
                    >
                      View all
                    </button>
                  </div>
                  {activeAgents.length === 0 ? (
                    <div className={styles.emptyCell}>
                      No agents running. Start one from a session.
                    </div>
                  ) : (
                    <div className={styles.rowList}>
                      {activeAgents.slice(0, 6).map((a) => (
                        <AgentRow
                          key={a.id}
                          name={a.displayName}
                          project={basename(a.session.repo_root)}
                          status={a.status}
                          meta={agentMeta(a.status)}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() =>
                            handleOpenSession(
                              a.session.id,
                              a.session.repo_root,
                              a.id,
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.eyebrow}>Devices</span>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={openDevices}
                    >
                      View all
                    </button>
                  </div>
                  {runningDevices.length === 0 ? (
                    <div className={styles.emptyCell}>
                      No devices online. Boot a simulator or start an agent.
                    </div>
                  ) : (
                    <div className={styles.rowList}>
                      {runningDevices.slice(0, 6).map((d) => (
                        <AgentRow
                          key={`${d.platform}:${d.deviceKey}`}
                          name={d.name}
                          project={
                            d.repoRoot
                              ? basename(d.repoRoot)
                              : d.platform.toUpperCase()
                          }
                          status={d.reserved ? "running" : "idle"}
                          meta={d.reserved ? "reserved" : "available"}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={openDevices}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <OrganizationDialogHost />
    </div>
  );
}
