import { useEffect, useState } from "react";
import { useRecentProjectsStore } from "../../stores/recentProjectsStore";
import { useProjects } from "../../hooks/useWorkspaces";
import { checkClaudeCli } from "../../lib/ipc";
import { OpenProjectDialog } from "../sidebar/OpenProjectDialog";
import { StagehandLogo, FolderIcon, CloseIcon } from "../shared/Icons";
import styles from "./HomeScreen.module.css";

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  return `…${path.slice(-(maxLen - 1))}`;
}

export function HomeScreen() {
  const { projects, removeProject } = useRecentProjectsStore();
  const { openProject } = useProjects();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [openingPath, setOpeningPath] = useState<null | string>(null);
  const [openError, setOpenError] = useState<null | string>(null);
  const [claudeCliMissing, setClaudeCliMissing] = useState(false);

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
      removeProject(path);
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

        {projects.length > 0 ? (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Projects</h2>
            <div className={styles.grid}>
              {projects.map((project) => (
                <ProjectCard
                  key={project.path}
                  project={project}
                  isOpening={openingPath === project.path}
                  onOpen={() => handleOpenProject(project.path)}
                  onRemove={() => removeProject(project.path)}
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
          onOpen={handleOpenProject}
          onClose={() => {
            setShowOpenProject(false);
            setOpenError(null);
          }}
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
          onClick={onOpen}
          disabled={isOpening}
          title={project.path}
        >
          {isOpening ? "Opening…" : "Open"}
        </button>
        <button
          className={styles.removeBtn}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from recents"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
