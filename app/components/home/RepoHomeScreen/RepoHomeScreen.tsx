import { useMemo } from "react";
import {
  AgentRow,
  Button,
  Icons,
  projectAccent,
  ShortcutsRail,
  StatCell,
  StatsStrip,
  WorkspaceCard,
} from "@argus/peacock";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { focusAgent } from "../../../lib/agentLifecycle";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useDevices } from "../../../stores/deviceStore";
import { triggerNewWorkspace } from "../../../stores/dialogStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { selectWorkspace, useWorkspaces } from "../../../stores/workspaceStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { HOME_SHORTCUTS } from "../HomeScreen/homeContent";
import styles from "../homeLayout.module.css";

interface RepoHomeScreenProps {
  canStart: boolean;
  isStarting: boolean;
  onResumeHistory: (sessionId: string) => void;
  onSelectAgent: (agentId: string, workspaceId: string) => void;
  onStart: () => void;
  onViewHistory: (historyId: string) => void;
  /** Repo root path — used to scope orchestration and chat history. */
  repoRoot: string | null;
  /** Current workspace ID (drives orchestration filter). */
  workspaceId: string;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function mapAgentStatus(
  status: "error" | "idle" | "running" | "stopped",
): "done" | "error" | "idle" | "running" {
  if (status === "running") {
    return "running";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "stopped") {
    return "done";
  }

  return "idle";
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

export function RepoHomeScreen({
  workspaceId,
  repoRoot,
  isStarting,
  canStart,
  onStart,
  onSelectAgent,
  onViewHistory,
  onResumeHistory,
}: RepoHomeScreenProps) {
  const agentsRecord = useAgentsRecord();
  const workspaces = useWorkspaces();
  const devices = useDevices();
  const recent = useRecentProjects();
  const history = useChatHistory(repoRoot);

  const repoWorkspaces = useMemo(
    () => (repoRoot ? workspaces.filter((w) => w.repo_root === repoRoot) : []),
    [workspaces, repoRoot],
  );

  const repoWorkspaceIds = useMemo(
    () => new Set(repoWorkspaces.map((w) => w.id)),
    [repoWorkspaces],
  );

  const repoAgents = useMemo(
    () =>
      Object.values(agentsRecord).filter((a) =>
        repoWorkspaceIds.has(a.workspace_id),
      ),
    [agentsRecord, repoWorkspaceIds],
  );

  const repoDevices = useMemo(
    () => (repoRoot ? devices.filter((d) => d.repoRoot === repoRoot) : []),
    [devices, repoRoot],
  );
  const runningDevices = repoDevices.filter((d) => d.online);

  const projectName = useMemo(() => {
    if (!repoRoot) {
      return "Workspace";
    }
    const rp = recent.find((r) => r.path === repoRoot);

    return rp?.name ?? basename(repoRoot);
  }, [recent, repoRoot]);

  const accent = useMemo(
    () => (repoRoot ? projectAccent(repoRoot) : "var(--accent)"),
    [repoRoot],
  );

  const stats = useMemo(() => {
    const running = repoAgents.filter((a) => a.status === "running").length;
    const idle = repoAgents.filter((a) => a.status === "idle").length;
    const errors = repoAgents.filter((a) => a.status === "error").length;

    return {
      agentsRunning: running,
      agentsIdle: idle,
      agentsTotal: repoAgents.length,
      errors,
      workspaces: repoWorkspaces.length,
      devicesOnline: runningDevices.length,
      devicesTotal: repoDevices.length,
    };
  }, [repoAgents, repoWorkspaces, runningDevices.length, repoDevices.length]);

  const handleSelectWorkspace = (id: string) => {
    selectWorkspace(id);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <div
            className={styles.brandMark}
            style={{ ["--hero-accent" as string]: accent }}
          >
            <div className={styles.heroBadge}>
              <Icons.FolderIcon size={18} />
            </div>
            <div>
              <h1 className={styles.title}>{projectName}</h1>
              <div className={styles.sub}>
                {stats.agentsRunning} agents · {stats.workspaces} workspaces
              </div>
            </div>
          </div>
          <div className={styles.heroSpacer} />
          <div className={styles.ctas}>
            <Button
              variant="ghost"
              leading={<Icons.PlusIcon size={12} />}
              onClick={triggerNewWorkspace}
            >
              New workspace
            </Button>
            <Button
              variant="primary"
              leading={<Icons.AgentStartIcon size={12} />}
              disabled={!canStart || isStarting}
              onClick={onStart}
            >
              {isStarting ? "Starting\u2026" : "Start agent"}
            </Button>
          </div>
        </div>

        {repoRoot && <div className={styles.repoPath}>{repoRoot}</div>}

        <StatsStrip>
          <StatCell
            label="Agents running"
            value={stats.agentsRunning}
            delta={
              stats.agentsIdle > 0
                ? `${stats.agentsIdle} idle`
                : "all responsive"
            }
            deltaTone={stats.agentsRunning > 0 ? "positive" : "neutral"}
            live={stats.agentsRunning > 0}
          />
          <StatCell
            label="Workspaces"
            value={stats.workspaces}
            delta="in this repo"
          />
          <StatCell
            label="Total agents"
            value={stats.agentsTotal}
            delta="across workspaces"
          />
          <StatCell
            label="Devices"
            value={stats.devicesOnline}
            delta={`${stats.devicesTotal} bound`}
            deltaTone={stats.devicesOnline > 0 ? "positive" : "neutral"}
            live={stats.devicesOnline > 0}
          />
          <StatCell
            label="Errors"
            value={stats.errors}
            delta="needs attention"
            deltaTone={stats.errors > 0 ? "negative" : "neutral"}
          />
        </StatsStrip>

        <div className={styles.grid}>
          <div className={styles.col}>
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.eyebrow}>Workspaces</span>
                <span className={styles.subMeta}>
                  {repoWorkspaces.length} total
                </span>
                <div className={styles.panelSpacer} />
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={triggerNewWorkspace}
                >
                  New
                </button>
              </div>
              <div className={styles.panelScroll}>
                {repoWorkspaces.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No workspaces yet. Create one to start a branch.
                  </div>
                ) : (
                  <div className={styles.wsGrid}>
                    {repoWorkspaces.map((ws) => {
                      const wsAgents = repoAgents.filter(
                        (a) => a.workspace_id === ws.id,
                      );
                      const hasErr = wsAgents.some((a) => a.status === "error");
                      const hasRun = wsAgents.some(
                        (a) => a.status === "running",
                      );
                      const statusTone: "error" | "idle" | "success" = hasErr
                        ? "error"
                        : hasRun
                          ? "success"
                          : "idle";

                      return (
                        <WorkspaceCard
                          key={ws.id}
                          branch={ws.display_name ?? ws.branch}
                          parentBranch={ws.base_branch ?? undefined}
                          selected={ws.id === workspaceId}
                          status={statusTone}
                          pulse={hasRun}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => handleSelectWorkspace(ws.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {repoRoot && history.loaded && history.entries.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.eyebrow}>Chat history</span>
                  <span className={styles.subMeta}>
                    {history.entries.length} sessions
                  </span>
                </div>
                <div className={styles.historyWrap}>
                  <ChatHistoryList
                    entries={history.entries}
                    repoRoot={repoRoot}
                    onClearAll={history.clearAll}
                    onDelete={history.remove}
                    onResume={onResumeHistory}
                    onView={onViewHistory}
                  />
                </div>
              </div>
            )}
          </div>

          <div className={styles.col}>
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.eyebrow}>Active agents</span>
                <span className={styles.subMeta}>
                  {repoAgents.length} in {projectName}
                </span>
              </div>
              <div className={styles.agentList}>
                {repoAgents.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No agents in this repo. Start one from a workspace.
                  </div>
                ) : (
                  repoAgents.map((a) => {
                    const ws = repoWorkspaces.find(
                      (w) => w.id === a.workspace_id,
                    );
                    const name = ws?.display_name ?? ws?.branch ?? a.agent_id;
                    const mapped = mapAgentStatus(a.status);

                    return (
                      <AgentRow
                        key={a.agent_id}
                        name={name}
                        project={ws?.branch ?? ""}
                        status={mapped}
                        meta={agentMeta(a.status)}
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          onSelectAgent(a.agent_id, a.workspace_id);
                          focusAgent(a.workspace_id, a.agent_id);
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.eyebrow}>Running devices</span>
                <span className={styles.subMeta}>
                  {runningDevices.length} online · {repoDevices.length} bound
                </span>
              </div>
              <div className={styles.agentList}>
                {repoDevices.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No devices bound to this repo.
                  </div>
                ) : (
                  repoDevices
                    .slice(0, 6)
                    .map((d) => (
                      <AgentRow
                        key={`${d.platform}:${d.deviceKey}`}
                        name={d.name}
                        project={d.platform.toUpperCase()}
                        status={
                          d.online ? (d.reserved ? "running" : "idle") : "idle"
                        }
                        meta={
                          d.online
                            ? d.reserved
                              ? "reserved"
                              : "available"
                            : "offline"
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
    </div>
  );
}
