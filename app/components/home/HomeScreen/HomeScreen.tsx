import { useEffect, useState } from "react";
import { useProjects } from "../../../hooks/useWorkspaces";
import { checkClaudeCli } from "../../../lib/ipc";
import {
  setActiveAgent,
  useAgentsRecord,
} from "../../../stores/agentStore";
import {
  removeRecentProject,
  useRecentProjects,
} from "../../../stores/recentProjectsStore";
import {
  selectWorkspace,
  useWorkspaces,
} from "../../../stores/workspaceStore";
import { OrchestrationTree } from "../../agent/OrchestrationTree/OrchestrationTree";
import { CloseIcon, FolderIcon, StagehandLogo } from "../../shared/Icons";
import { OpenProjectDialog } from "../../sidebar/OpenProjectDialog";
import styles from "./HomeScreen.module.css";

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) {
    return path;
  }

  return `…${path.slice(-(maxLen - 1))}`;
}

export function HomeScreen() {
  const recentProjects = useRecentProjects();
  const { openProject } = useProjects();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [claudeCliMissing, setClaudeCliMissing] = useState(false);
  const [treeFilter, setTreeFilter] = useState<string>("all");

  const agents = useAgentsRecord();
  const workspaces = useWorkspaces();
  const hasAnyAgents = Object.keys(agents).length > 0;

  const handleSelectAgent = (agentId: string, workspaceId: string) => {
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    // Ensure the containing project is open, then select the workspace and
    // make the clicked agent active.
    openProject(ws.repo_root)
      .then(() => {
        selectWorkspace(workspaceId);
        setActiveAgent(workspaceId, agentId);
      })
      .catch(() => {});
  };

  useEffect(() => {
    checkClaudeCli()
      .then(() => setClaudeCliMissing(false))
      .catch(() => setClaudeCliMissing(true));
  }, []);

  const handleOpenProject = async (path: string) => {
    setOpenError(null);
    setOpeningPath(path);
    try {
      await openProject(path);
      setShowOpenProject(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
      removeRecentProject(path);
    } finally {
      setOpeningPath(null);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <div className={styles.header}>
          <StagehandLogo className={styles.logo} />
          <h1 className={styles.title}>Stagehand</h1>
          <p className={styles.subtitle}>
            Select a project to get started, or add a new repository.
          </p>
        </div>

        {claudeCliMissing && (
          <div className={styles.warningBanner} role="status">
            Claude Code CLI not found on PATH. Agents will not work until it is
            installed.
          </div>
        )}

        {openError && (
          <div className={styles.errorBanner} role="alert">
            {openError}
          </div>
        )}

        <div className={styles.actions}>
          <button
            className={styles.addBtn}
            onClick={() => setShowOpenProject(true)}
          >
            <FolderIcon />
            Add repository
          </button>
        </div>

        {hasAnyAgents && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Active Agents</h2>
            <div className={styles.treeWrap}>
              <OrchestrationTree
                activeAgentId={null}
                showFilter
                title="All agents"
                workspaceFilter={treeFilter}
                onSelectAgent={handleSelectAgent}
                onWorkspaceFilterChange={setTreeFilter}
              />
            </div>
          </div>
        )}

        {recentProjects.length > 0 ? (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Projects</h2>
            <div className={styles.grid}>
              {recentProjects.map((project) => (
                <ProjectCard
                  key={project.path}
                  isOpening={openingPath === project.path}
                  project={project}
                  onOpen={() => handleOpenProject(project.path)}
                  onRemove={() => removeRecentProject(project.path)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyText}>No recent projects yet.</p>
            <p className={styles.emptyHint}>Add a repository to get started.</p>
          </div>
        )}
      </div>

      {showOpenProject && (
        <OpenProjectDialog
          onClose={() => {
            setShowOpenProject(false);
            setOpenError(null);
          }}
          onOpen={handleOpenProject}
        />
      )}
    </div>
  );
}

interface ProjectCardProps {
  isOpening: boolean;
  onOpen: () => void;
  onRemove: () => void;
  project: { lastOpened: number; name: string; path: string };
}

function ProjectCard({
  project,
  isOpening,
  onOpen,
  onRemove,
}: ProjectCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardIcon}>
        <FolderIcon />
      </div>
      <div className={styles.cardBody}>
        <span className={styles.cardName}>{project.name}</span>
        <span className={styles.cardPath} title={project.path}>
          {truncatePath(project.path, 48)}
        </span>
      </div>
      <div className={styles.cardActions}>
        <button
          className={styles.openBtn}
          disabled={isOpening}
          title={project.path}
          onClick={onOpen}
        >
          {isOpening ? "Opening…" : "Open"}
        </button>
        <button
          className={styles.removeBtn}
          title="Remove from recents"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
