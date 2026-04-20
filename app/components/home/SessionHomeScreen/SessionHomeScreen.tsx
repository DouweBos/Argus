import { useEffect, useMemo, useState } from "react";
import {
  AgentRow,
  Button,
  DiffStat,
  Icons,
  projectAccent,
  ShortcutsRail,
  StatCell,
  StatsStrip,
} from "@argus/peacock";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { useMergeStatus } from "../../../hooks/useMergeStatus";
import { focusAgent } from "../../../lib/agentLifecycle";
import { listen } from "../../../lib/events";
import { watchSession } from "../../../lib/ipc";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useDevices } from "../../../stores/deviceStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { useSessions } from "../../../stores/sessionStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { HOME_SHORTCUTS } from "../HomeScreen/homeContent";
import { PathLink } from "../PathLink/PathLink";
import { ReadyToMergeCard } from "../RepoHomeScreen/ReadyToMergeCard";
import styles from "../homeLayout.module.css";

interface SessionHomeScreenProps {
  canStart: boolean;
  isStarting: boolean;
  onResumeHistory: (sessionId: string) => void;
  onSelectAgent: (agentId: string, sessionId: string) => void;
  onStart: () => void;
  onStartPlan: () => void;
  onViewHistory: (historyId: string) => void;
  repoRoot: string | null;
  sessionId: string;
}

interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
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

  return "idle";
}

export function SessionHomeScreen({
  sessionId,
  repoRoot,
  isStarting,
  canStart,
  onStart,
  onStartPlan,
  onSelectAgent,
  onViewHistory,
  onResumeHistory,
}: SessionHomeScreenProps) {
  const sessions = useSessions();
  const agentsRecord = useAgentsRecord();
  const devices = useDevices();
  const recent = useRecentProjects();
  const history = useChatHistory(repoRoot);
  const handleClearAllHistory = history.clearAll;
  const handleDeleteHistoryEntry = history.remove;

  const session = useMemo(
    () => sessions.find((w) => w.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const sessionHistoryEntries = useMemo(
    () =>
      session
        ? history.entries.filter((e) => e.sessionBranch === session.branch)
        : [],
    [history.entries, session],
  );

  const sessionAgents = useMemo(
    () => Object.values(agentsRecord).filter((a) => a.session_id === sessionId),
    [agentsRecord, sessionId],
  );

  const sessionDevices = useMemo(
    () => devices.filter((d) => d.sessionId === sessionId),
    [devices, sessionId],
  );

  const { commitsAhead, conflicts, hasStaged } = useMergeStatus(sessionId);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<DiffStats>(
      `session:diff-changed:${sessionId}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );
    watchSession(sessionId).catch(() => {});

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [sessionId]);

  const projectName = useMemo(() => {
    if (!repoRoot) {
      return "";
    }
    const rp = recent.find((r) => r.path === repoRoot);

    return rp?.name ?? basename(repoRoot);
  }, [recent, repoRoot]);

  const accent = useMemo(
    () => (repoRoot ? projectAccent(repoRoot) : "var(--accent)"),
    [repoRoot],
  );

  const displayName = session?.display_name ?? session?.branch ?? "Session";
  const branch = session?.branch ?? "";
  const baseBranch = session?.base_branch ?? null;
  const additions = diffStats?.additions ?? 0;
  const deletions = diffStats?.deletions ?? 0;
  const filesChanged = diffStats?.files ?? 0;
  const runningDevices = sessionDevices.filter((d) => d.online);
  const hasConflicts = conflicts.length > 0;

  const runningAgents = sessionAgents.filter(
    (a) => a.status === "running",
  ).length;
  const idleAgents = sessionAgents.filter((a) => a.status === "idle").length;
  const errorAgents = sessionAgents.filter((a) => a.status === "error").length;

  let commitsAheadDelta = "";
  if (hasConflicts) {
    commitsAheadDelta = `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`;
  } else if (baseBranch) {
    commitsAheadDelta = `of ${baseBranch}`;
  }

  let agentsDelta = "none active";
  if (runningAgents > 0) {
    agentsDelta = `${runningAgents} running`;
  } else if (idleAgents > 0) {
    agentsDelta = `${idleAgents} idle`;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <div
            className={styles.brandMark}
            style={{ ["--hero-accent" as string]: accent }}
          >
            <div className={styles.heroBadge}>
              <Icons.BranchIcon size={18} />
            </div>
            <div>
              <h1 className={styles.title}>{displayName}</h1>
              <div className={styles.sub}>
                <span className={styles.branchChip}>
                  <Icons.BranchIcon size={10} />
                  {branch}
                </span>
                {baseBranch && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span>from {baseBranch}</span>
                  </>
                )}
                {projectName && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span>in {projectName}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={styles.heroSpacer} />
          <div className={styles.ctas}>
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

        {session?.path && <PathLink path={session.path} />}

        <StatsStrip>
          <StatCell
            label="Commits ahead"
            value={commitsAhead}
            delta={commitsAheadDelta}
            deltaTone={hasConflicts ? "negative" : "neutral"}
          />
          <StatCell
            label="Lines added"
            value={additions}
            delta={filesChanged > 0 ? `${filesChanged} files` : "no changes"}
            deltaTone={additions > 0 ? "positive" : "neutral"}
          />
          <StatCell
            label="Lines removed"
            value={deletions}
            delta={hasStaged ? "staged" : "uncommitted"}
            deltaTone={deletions > 0 ? "negative" : "neutral"}
          />
          <StatCell
            label="Agents"
            value={sessionAgents.length}
            delta={agentsDelta}
            deltaTone={runningAgents > 0 ? "positive" : "neutral"}
            live={runningAgents > 0}
          />
          <StatCell
            label="Errors"
            value={errorAgents}
            delta="needs attention"
            deltaTone={errorAgents > 0 ? "negative" : "neutral"}
          />
        </StatsStrip>

        <ReadyToMergeCard
          baseBranch={session?.base_branch}
          sessionBranch={session?.branch}
          sessionId={sessionId}
        />

        <div className={styles.grid}>
          <div className={styles.col}>
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.eyebrow}>Changes</span>
                <span className={styles.subMeta}>
                  {filesChanged} file{filesChanged === 1 ? "" : "s"}
                </span>
                <div className={styles.panelSpacer} />
                {filesChanged > 0 && (
                  <DiffStat
                    added={additions}
                    removed={deletions}
                    files={filesChanged}
                  />
                )}
              </div>
              {session?.description && (
                <div
                  style={{
                    fontSize: "var(--font-size-sm)",
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {session.description}
                </div>
              )}
              {filesChanged === 0 && !session?.description && (
                <div className={styles.emptyCell}>
                  No uncommitted changes. Start an agent to begin.
                </div>
              )}
            </div>

            {repoRoot && history.loaded && sessionHistoryEntries.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.eyebrow}>Chat history</span>
                  <span className={styles.subMeta}>
                    {sessionHistoryEntries.length} in this session
                  </span>
                </div>
                <div className={styles.historyWrap}>
                  <ChatHistoryList
                    entries={sessionHistoryEntries}
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
                <span className={styles.eyebrow}>Agents</span>
                <span className={styles.subMeta}>
                  {sessionAgents.length} in this session
                </span>
              </div>
              <div className={styles.agentList}>
                {sessionAgents.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No agents yet. Start one to pick up work.
                  </div>
                ) : (
                  sessionAgents.map((a) => (
                    <AgentRow
                      key={a.agent_id}
                      name={displayName}
                      project={branch}
                      status={mapAgentStatus(a.status)}
                      meta={agentMeta(a.status)}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        onSelectAgent(a.agent_id, a.session_id);
                        focusAgent(a.session_id, a.agent_id);
                      }}
                    />
                  ))
                )}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.eyebrow}>Devices</span>
                <span className={styles.subMeta}>
                  {runningDevices.length} online · {sessionDevices.length} bound
                </span>
              </div>
              <div className={styles.agentList}>
                {sessionDevices.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No devices bound to this session.
                  </div>
                ) : (
                  sessionDevices.slice(0, 6).map((d) => {
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
