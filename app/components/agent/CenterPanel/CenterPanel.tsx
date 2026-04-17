import { useMemo } from "react";
import {
  setActiveCenterView,
  setAgentPanel,
  useActiveCenterView,
  useAgentPanel,
} from "../../../stores/editorStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { EditorPanel } from "../../editor/EditorPanel";
import { ArgusLogo, HomeIcon } from "../../shared/Icons";
import { AgentView } from "../AgentView";
import { GitView } from "../GitView";
import styles from "./CenterPanel.module.css";

interface CenterPanelProps {
  workspaceId: string | null;
}

export function CenterPanel({ workspaceId }: CenterPanelProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () =>
      workspaceId
        ? (workspaces.find((w) => w.id === workspaceId) ?? null)
        : null,
    [workspaceId, workspaces],
  );

  const activeView = useActiveCenterView();
  const setActiveView = setActiveCenterView;
  const agentPanel = useAgentPanel();
  const homeActive = activeView === "agents" && agentPanel === "home";
  const agentsActive = activeView === "agents" && agentPanel === "agent";

  if (!workspaceId || !workspace) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyContent}>
          <ArgusLogo className={styles.logo} />
          <h2 className={styles.emptyTitle}>Argus</h2>
          <p className={styles.emptySubtitle}>
            Select or create a workspace to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          <button
            aria-label="Repo home"
            className={`${styles.homeTab} ${homeActive ? styles.viewTabActive : ""}`}
            title="Repo home"
            onClick={() => {
              setActiveView("agents");
              setAgentPanel("home");
            }}
          >
            <HomeIcon />
          </button>
          <button
            className={`${styles.viewTab} ${agentsActive ? styles.viewTabActive : ""}`}
            onClick={() => {
              setActiveView("agents");
              setAgentPanel("agent");
            }}
          >
            Agents
          </button>
          <button
            className={`${styles.viewTab} ${activeView === "editor" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("editor")}
          >
            Editor
          </button>
          <button
            className={`${styles.viewTab} ${activeView === "git" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("git")}
          >
            Git
          </button>
        </div>
      </div>

      {/* Content area */}
      {activeView === "agents" && <AgentView workspaceId={workspaceId} />}

      {activeView === "editor" && <EditorPanel workspaceId={workspaceId} />}

      {activeView === "git" && (
        <GitView
          baseBranch={workspace?.base_branch}
          branchName={workspace?.branch}
          repoRoot={workspace?.repo_root ?? ""}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
