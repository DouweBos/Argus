import { useMemo } from "react";
import {
  AgentRow,
  Button,
  Icons,
  projectAccent,
  ShortcutsRail,
  StatCell,
  StatsStrip,
  SessionCard,
} from "@argus/peacock";
import { useArgusJson } from "../../../hooks/useArgusJson";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { focusAgent } from "../../../lib/agentLifecycle";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useConversations } from "../../../stores/conversationStore";
import { useDevices } from "../../../stores/deviceStore";
import {
  showCreateSessionDialog,
  triggerNewSession,
} from "../../../stores/dialogStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { HOME_SHORTCUTS } from "../HomeScreen/homeContent";
import { OpenInEditorButton } from "../OpenInEditor/OpenInEditorButton";
import { PathLink } from "../PathLink/PathLink";
import styles from "../homeLayout.module.css";
import { NoArgusJsonCard } from "./NoArgusJsonCard";

interface RepoHomeScreenProps {
  canStart: boolean;
  isStarting: boolean;
  onResumeHistory: (sessionId: string) => void;
  onSelectAgent: (agentId: string, sessionId: string) => void;
  onStart: () => void;
  onStartPlan: () => void;
  onViewHistory: (historyId: string) => void;
  /** Repo root path — used to scope orchestration and chat history. */
  repoRoot: string | null;
  /** Current session ID (drives orchestration filter). */
  sessionId: string;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function mapAgentStatus(
  status: "error" | "idle" | "requires_action" | "running" | "stopped",
): "done" | "error" | "idle" | "running" {
  if (status === "running" || status === "requires_action") {
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
  sessionId,
  repoRoot,
  isStarting,
  canStart,
  onStart,
  onStartPlan,
  onSelectAgent,
  onViewHistory,
  onResumeHistory,
}: RepoHomeScreenProps) {
  const agentsRecord = useAgentsRecord();
  const conversations = useConversations();
  const sessions = useSessions();
  const devices = useDevices();
  const recent = useRecentProjects();
  const history = useChatHistory(repoRoot);
  const argusJson = useArgusJson(repoRoot);
  const handleClearAllHistory = history.clearAll;
  const handleDeleteHistoryEntry = history.remove;
  const handleArgusJsonGenerated = argusJson.refresh;

  const repoSessions = useMemo(
    () => (repoRoot ? sessions.filter((w) => w.repo_root === repoRoot) : []),
    [sessions, repoRoot],
  );

  const visibleSessions = useMemo(
    () => repoSessions.filter((w) => w.kind !== "project_root"),
    [repoSessions],
  );

  const repoSessionIds = useMemo(
    () => new Set(repoSessions.map((w) => w.id)),
    [repoSessions],
  );

  const repoAgents = useMemo(
    () =>
      Object.values(agentsRecord).filter((a) =>
        repoSessionIds.has(a.session_id),
      ),
    [agentsRecord, repoSessionIds],
  );

  const repoDevices = useMemo(
    () => (repoRoot ? devices.filter((d) => d.repoRoot === repoRoot) : []),
    [devices, repoRoot],
  );
  const runningDevices = repoDevices.filter((d) => d.online);

  const projectName = useMemo(() => {
    if (!repoRoot) {
      return "Session";
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
      sessions: repoSessions.length,
      devicesOnline: runningDevices.length,
      devicesTotal: repoDevices.length,
    };
  }, [repoAgents, repoSessions, runningDevices.length, repoDevices.length]);

  const handleSelectSession = (id: string) => {
    selectSession(id);
  };

  const handleNewSession = () => {
    if (repoRoot) {
      showCreateSessionDialog(repoRoot);
    } else {
      triggerNewSession();
    }
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
                {stats.agentsRunning} agents · {stats.sessions} sessions
              </div>
            </div>
          </div>
          <div className={styles.heroSpacer} />
          <div className={styles.ctas}>
            {repoRoot && <OpenInEditorButton path={repoRoot} />}
            <Button
              variant="ghost"
              leading={<Icons.PlusIcon size={12} />}
              onClick={handleNewSession}
            >
              New session
            </Button>
            <Button
              variant="ghost"
              leading={<Icons.AgentStartIcon size={12} />}
              disabled={!canStart || isStarting}
              onClick={onStartPlan}
              title="Start in plan mode — agent must present a plan for approval before any writes"
            >
              Plan mode
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

        {repoRoot && <PathLink path={repoRoot} />}

        {repoRoot && argusJson.exists === false && (
          <NoArgusJsonCard
            repoRoot={repoRoot}
            onGenerated={handleArgusJsonGenerated}
          />
        )}

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
            label="Sessions"
            value={stats.sessions}
            delta="in this repo"
          />
          <StatCell
            label="Total agents"
            value={stats.agentsTotal}
            delta="across sessions"
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
                <span className={styles.eyebrow}>Sessions</span>
                <span className={styles.subMeta}>
                  {visibleSessions.length} total
                </span>
                <div className={styles.panelSpacer} />
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={handleNewSession}
                >
                  New
                </button>
              </div>
              <div className={styles.panelScroll}>
                {visibleSessions.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No sessions yet. Create one to start a branch.
                  </div>
                ) : (
                  <div className={styles.wsGrid}>
                    {visibleSessions.map((ws) => {
                      const wsAgents = repoAgents.filter(
                        (a) => a.session_id === ws.id,
                      );
                      const hasErr = wsAgents.some((a) => a.status === "error");
                      const hasRun = wsAgents.some(
                        (a) => a.status === "running",
                      );
                      let statusTone: "error" | "idle" | "success" = "idle";
                      if (hasErr) {
                        statusTone = "error";
                      } else if (hasRun) {
                        statusTone = "success";
                      }

                      return (
                        <SessionCard
                          key={ws.id}
                          branch={ws.display_name ?? ws.branch}
                          parentBranch={ws.base_branch ?? undefined}
                          selected={ws.id === sessionId}
                          status={statusTone}
                          pulse={hasRun}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => handleSelectSession(ws.id)}
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
                    onClearAll={handleClearAllHistory}
                    onDelete={handleDeleteHistoryEntry}
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
                    No agents in this repo. Start one from a session.
                  </div>
                ) : (
                  repoAgents.map((a) => {
                    const ws = repoSessions.find((w) => w.id === a.session_id);
                    const conv = conversations[a.agent_id];
                    const convTitle = conv?.title?.trim();
                    const name =
                      convTitle ||
                      ws?.display_name ||
                      ws?.branch ||
                      a.agent_id;
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
                          onSelectAgent(a.agent_id, a.session_id);
                          focusAgent(a.session_id, a.agent_id);
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
                  repoDevices.slice(0, 6).map((d) => {
                    let meta = "offline";
                    if (d.online) {
                      meta = d.reserved ? "reserved" : "available";
                    }

                    return (
                      <AgentRow
                        key={`${d.platform}:${d.deviceKey}`}
                        name={d.name}
                        project={d.platform.toUpperCase()}
                        status={d.online && d.reserved ? "running" : "idle"}
                        meta={meta}
                      />
                    );
                  })
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
