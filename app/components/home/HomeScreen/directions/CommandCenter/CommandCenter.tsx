import type { HomeData, HomeProject } from "../../useHomeData";
import {
  AgentRow,
  Button,
  Icons,
  ProjectCard,
  ShortcutsRail,
  StatCell,
  StatsStrip,
} from "@argus/peacock";
import { setCenterView } from "../../../../../stores/centerViewStore";
import { removeRecentProject } from "../../../../../stores/recentProjectsStore";
import { selectSession } from "../../../../../stores/sessionStore";
import { OrganizationsPanel } from "../../../OrganizationsPanel/OrganizationsPanel";
import { HOME_SHORTCUTS } from "../../homeContent";
import styles from "./CommandCenter.module.css";

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

export interface CommandCenterProps {
  data: HomeData & { formatLastOpened: (ms: number) => string };
  onAddRepository: () => void;
  onNewSession: () => void;
  onOpenProject: (proj: HomeProject) => void;
  onOpenSession: (
    sessionId: string,
    repoPath: string,
    agentId?: string,
  ) => void;
}

export function CommandCenter({
  data,
  onAddRepository,
  onNewSession,
  onOpenProject,
  onOpenSession,
}: CommandCenterProps) {
  const { projects, activeAgents, devices, stats, formatLastOpened } = data;
  const runningDevices = devices.filter((d) => d.online);

  const openDevices = () => {
    selectSession(null);
    setCenterView("devices");
  };

  const openAgents = () => {
    selectSession(null);
    setCenterView("agents");
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.hero}>
        <div className={styles.brandMark}>
          <Icons.ArgusLogo size={34} />
          <div>
            <h1 className={styles.title}>Argus</h1>
            <div className={styles.sub}>
              {stats.agentsRunning} agents · {stats.projects} repos
            </div>
          </div>
        </div>
        <div className={styles.heroSpacer} />
        <div className={styles.ctas}>
          <Button
            variant="ghost"
            leading={<Icons.FolderIcon size={12} />}
            onClick={onAddRepository}
          >
            Open repo
          </Button>
          <Button
            variant="primary"
            leading={<Icons.PlusIcon size={12} />}
            onClick={onNewSession}
          >
            New session
          </Button>
        </div>
      </div>

      <StatsStrip>
        <StatCell
          label="Agents running"
          value={stats.agentsRunning}
          delta={
            stats.agentsIdle > 0 ? `${stats.agentsIdle} idle` : "all responsive"
          }
          deltaTone={stats.agentsRunning > 0 ? "positive" : "neutral"}
          live={stats.agentsRunning > 0}
        />
        <StatCell
          label="Sessions"
          value={stats.sessions}
          delta={`${projects.length} repos`}
        />
        <StatCell label="Repos" value={stats.projects} delta="in rotation" />
        <StatCell
          label="Devices"
          value={stats.devicesRunning}
          delta={`${stats.devicesTotal} total`}
          deltaTone={stats.devicesRunning > 0 ? "positive" : "neutral"}
          live={stats.devicesRunning > 0}
        />
        <StatCell
          label="Total agents"
          value={activeAgents.length}
          delta="across all sessions"
        />
        <StatCell
          label="Errors"
          value={activeAgents.filter((a) => a.status === "error").length}
          delta="needs attention"
          deltaTone={
            activeAgents.some((a) => a.status === "error")
              ? "negative"
              : "neutral"
          }
        />
      </StatsStrip>

      <OrganizationsPanel />

      <div className={styles.grid}>
        <div className={styles.col}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.eyebrow}>Recent projects</span>
              <span className={styles.sub}>{projects.length} repos</span>
              <div className={styles.panelSpacer} />
            </div>
            <div className={styles.panelScroll}>
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
                      onClick={() => onOpenProject(p)}
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
          </div>
        </div>

        <div className={styles.col}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.eyebrow}>Active agents</span>
              <span className={styles.sub}>
                {activeAgents.length} across {stats.projects} repos
              </span>
              <div className={styles.panelSpacer} />
              <button
                type="button"
                onClick={openAgents}
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                View all
              </button>
            </div>
            <div className={styles.agentList}>
              {activeAgents.length === 0 ? (
                <div className={styles.emptyCell}>
                  No agents running. Start one from a session.
                </div>
              ) : (
                activeAgents.map((a) => (
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
                      onOpenSession(
                        a.session.id,
                        a.session.repo_root,
                        a.id,
                      )
                    }
                  />
                ))
              )}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.eyebrow}>Running devices</span>
              <span className={styles.sub}>
                {runningDevices.length} online · {devices.length} total
              </span>
              <div className={styles.panelSpacer} />
              <button
                type="button"
                onClick={openDevices}
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                View all
              </button>
            </div>
            <div className={styles.agentList}>
              {runningDevices.length === 0 ? (
                <div className={styles.emptyCell}>
                  No devices online. Boot a simulator or start an agent.
                </div>
              ) : (
                runningDevices
                  .slice(0, 6)
                  .map((d) => (
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
                  ))
              )}
            </div>
          </div>

          <ShortcutsRail shortcuts={HOME_SHORTCUTS.slice(0, 4)} />
        </div>
      </div>
    </div>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
