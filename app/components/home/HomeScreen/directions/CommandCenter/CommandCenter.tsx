import type { HomeData, HomeProject } from "../../useHomeData";
import {
  AgentRow,
  Button,
  Icons,
  ProjectCard,
  ShortcutsRail,
  SparkleIcon,
  StatCell,
  StatsStrip,
  TipCard,
} from "@argus/peacock";
import { removeRecentProject } from "../../../../../stores/recentProjectsStore";
import { HOME_SHORTCUTS, HOME_TIPS } from "../../homeContent";
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
  onNewWorkspace: () => void;
  onOpenProject: (proj: HomeProject) => void;
  onOpenWorkspace: (workspaceId: string, repoPath: string) => void;
}

export function CommandCenter({
  data,
  onAddRepository,
  onNewWorkspace,
  onOpenProject,
  onOpenWorkspace,
}: CommandCenterProps) {
  const { projects, activeAgents, stats, formatLastOpened } = data;

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
            onClick={onNewWorkspace}
          >
            New workspace
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
          label="Workspaces"
          value={stats.workspaces}
          delta={`${projects.length} repos`}
        />
        <StatCell label="Repos" value={stats.projects} delta="in rotation" />
        <StatCell
          label="Total agents"
          value={activeAgents.length}
          delta="across all workspaces"
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
          <div className={styles.tipsStrip}>
            {HOME_TIPS.map((t) => (
              <TipCard
                key={t.title}
                icon={<SparkleIcon size={11} />}
                title={t.title}
                body={t.body}
              />
            ))}
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
            </div>
            <div className={styles.agentList}>
              {activeAgents.length === 0 ? (
                <div className={styles.emptyCell}>
                  No agents running. Start one from a workspace.
                </div>
              ) : (
                activeAgents.map((a) => (
                  <AgentRow
                    key={a.id}
                    name={a.branch}
                    project={basename(a.workspace.repo_root)}
                    status={a.status}
                    meta={agentMeta(a.status)}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      onOpenWorkspace(a.workspace.id, a.workspace.repo_root)
                    }
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
