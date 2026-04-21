import { useMemo } from "react";
import { Chip } from "@argus/peacock";
import {
  setActiveCenterView,
  useActiveCenterView,
} from "../../../stores/editorStore";
import { useSessions } from "../../../stores/sessionStore";
import { EditorPanel } from "../../editor/EditorPanel";
import { HomeScreen } from "../../home/HomeScreen";
import { RunControl } from "../../layout/RunControl";
import { AgentView } from "../AgentView";
import { GitView } from "../GitView";
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

  const activeView = useActiveCenterView();
  const setActiveView = setActiveCenterView;

  if (!sessionId || !session) {
    return <HomeScreen />;
  }

  return (
    <div className={styles.panel}>
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          <Chip
            interactive
            className={
              activeView === "agents" || activeView === "home"
                ? styles.chipActive
                : undefined
            }
            onClick={() => setActiveView("agents")}
          >
            Agents
          </Chip>
          <Chip
            interactive
            className={activeView === "editor" ? styles.chipActive : undefined}
            onClick={() => setActiveView("editor")}
          >
            Editor
          </Chip>
          <Chip
            interactive
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
      {(activeView === "agents" || activeView === "home") && (
        <AgentView sessionId={sessionId} />
      )}

      {activeView === "editor" && <EditorPanel sessionId={sessionId} />}

      {activeView === "git" && (
        <GitView
          baseBranch={session?.base_branch}
          branchName={session?.branch}
          repoRoot={session?.repo_root ?? ""}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
