import { useMemo } from "react";
import { Chip, EmptyState, Icons } from "@argus/peacock";
import {
  setActiveCenterView,
  useActiveCenterView,
} from "../../../stores/editorStore";
import { useSessions } from "../../../stores/sessionStore";
import { HomeScreen } from "../../home/HomeScreen";
import { RunControl } from "../../layout/RunControl";
import { AgentView } from "../AgentView";
import { GitView } from "../GitView";
import { HomePanel } from "../HomePanel";
import { SessionUnavailable } from "../SessionUnavailable";
import styles from "./CenterPanel.module.css";

interface CenterPanelProps {
  sessionId: string | null;
}

export function CenterPanel({ sessionId }: CenterPanelProps) {
  const sessions = useSessions();
  const session = useMemo(
    () =>
      sessionId ? (sessions.find((w) => w.id === sessionId) ?? null) : null,
    [sessionId, sessions],
  );

  const projectSessionId = useMemo(
    () =>
      sessions.find(
        (w) => w.kind === "project_root" && w.repo_root === session?.repo_root,
      )?.id,
    [sessions, session?.repo_root],
  );

  const activeView = useActiveCenterView();
  const setActiveView = setActiveCenterView;

  if (!sessionId || !session) {
    return <HomeScreen />;
  }

  // Every panel below reads the session's files; against a disconnected drive
  // they would each fail in their own way.
  if (session.availability === "unavailable") {
    return (
      <SessionUnavailable
        session={session}
        projectSessionId={projectSessionId}
      />
    );
  }

  return (
    <div className={styles.panel}>
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          <Chip
            interactive
            leading={<Icons.HomeIcon size={12} />}
            className={activeView === "home" ? styles.chipActive : undefined}
            onClick={() => setActiveView("home")}
          >
            Home
          </Chip>
          <Chip
            interactive
            leading={<Icons.AgentIcon size={12} />}
            className={activeView === "agents" ? styles.chipActive : undefined}
            onClick={() => setActiveView("agents")}
          >
            Agents
          </Chip>
          <Chip
            interactive
            leading={<Icons.BranchIcon size={12} />}
            className={activeView === "git" ? styles.chipActive : undefined}
            onClick={() => setActiveView("git")}
          >
            Git
          </Chip>
        </div>
        <div className={styles.runControl}>
          <RunControl key={sessionId} sessionId={sessionId} />
        </div>
      </div>

      {/* Content area */}
      <div className={styles.body}>
        {activeView === "home" && (
          <HomePanel key={sessionId} sessionId={sessionId} />
        )}

        {activeView === "agents" && <AgentView sessionId={sessionId} />}

        {activeView === "git" &&
          (session.status === "initializing" ? (
            <EmptyState
              icon={<Icons.BranchIcon size={20} />}
              title="Setting up worktree…"
              body="The git view becomes available once the session finishes initializing."
            />
          ) : (
            <GitView
              baseBranch={session?.base_branch}
              branchName={session?.branch}
              repoRoot={session?.repo_root ?? ""}
              scope={session?.kind === "project_root" ? "project" : "session"}
              sessionId={sessionId}
            />
          ))}
      </div>
    </div>
  );
}
