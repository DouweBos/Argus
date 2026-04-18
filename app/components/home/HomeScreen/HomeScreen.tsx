import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  EmptyHome,
  Icons,
  Kbd,
  SparkleIcon,
  TipCard,
} from "@argus/peacock";
import { useProjects } from "../../../hooks/useWorkspaces";
import { checkClaudeCli } from "../../../lib/ipc";
import { removeRecentProject } from "../../../stores/recentProjectsStore";
import { selectWorkspace } from "../../../stores/workspaceStore";
import { CreateWorkspaceDialog } from "../../sidebar/CreateWorkspaceDialog";
import { OpenProjectDialog } from "../../sidebar/OpenProjectDialog";
import { DirectionPicker } from "./DirectionPicker/DirectionPicker";
import styles from "./HomeScreen.module.css";
import { NewWorkspacePicker } from "./NewWorkspacePicker";
import { CommandCenter } from "./directions/CommandCenter/CommandCenter";
import { LiveActivity } from "./directions/LiveActivity/LiveActivity";
import { Orrery } from "./directions/Orrery/Orrery";
import { HOME_SHORTCUTS, HOME_TIPS } from "./homeContent";
import { useHomeData, type HomeProject } from "./useHomeData";
import { useHomeDirection } from "./useHomeDirection";

export function HomeScreen() {
  const data = useHomeData();
  const [direction, setDirection] = useHomeDirection();
  const { openProject } = useProjects();
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [claudeCliMissing, setClaudeCliMissing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [createRepoRoot, setCreateRepoRoot] = useState<string | null>(null);

  useEffect(() => {
    checkClaudeCli()
      .then(() => setClaudeCliMissing(false))
      .catch(() => setClaudeCliMissing(true));
  }, []);

  const handleOpenPath = async (path: string) => {
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

  const handleOpenProject = (p: HomeProject) => {
    handleOpenPath(p.path).catch(() => {});
  };

  const handleOpenWorkspace = async (workspaceId: string, repoPath: string) => {
    try {
      await openProject(repoPath, { autoSelect: false });
      selectWorkspace(workspaceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
    }
  };

  const handleAddRepository = () => setShowOpenProject(true);

  const handleNewWorkspace = () => {
    if (data.projects.length === 0) {
      setShowOpenProject(true);

      return;
    }
    if (data.projects.length === 1) {
      const only = data.projects[0];
      if (only) {
        setCreateRepoRoot(only.path);
      }

      return;
    }
    setShowPicker(true);
  };

  const directionProps = {
    data,
    onAddRepository: handleAddRepository,
    onNewWorkspace: handleNewWorkspace,
    onOpenProject: handleOpenProject,
    onOpenWorkspace: handleOpenWorkspace,
  };

  const isEmpty = data.projects.length === 0;

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {claudeCliMissing && (
          <Banner tone="warning">
            Claude Code CLI not found on PATH. Agents will not work until it is
            installed.
          </Banner>
        )}
        {openError && (
          <Banner tone="error">
            {openError}
            {openingPath && `  (${openingPath})`}
          </Banner>
        )}

        <div className={styles.body}>
          {isEmpty ? (
            <EmptyHome
              actions={
                <>
                  <Button
                    variant="primary"
                    leading={<Icons.FolderIcon size={13} />}
                    onClick={handleAddRepository}
                  >
                    Add repository
                  </Button>
                  <Button
                    variant="ghost"
                    leading={<SparkleIcon size={13} />}
                    onClick={handleAddRepository}
                  >
                    Try the tour
                  </Button>
                </>
              }
              tips={HOME_TIPS.map((t) => (
                <TipCard
                  key={t.title}
                  icon={<SparkleIcon size={11} />}
                  title={t.title}
                  body={t.body}
                />
              ))}
              shortcuts={HOME_SHORTCUTS.slice(0, 3).map((s) => (
                <span
                  key={s.label}
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  <Kbd keys={s.keys} />
                  {s.label}
                </span>
              ))}
            />
          ) : (
            <>
              {direction === "command-center" && (
                <CommandCenter {...directionProps} />
              )}
              {direction === "live-activity" && (
                <LiveActivity {...directionProps} />
              )}
              {direction === "orrery" && <Orrery {...directionProps} />}
            </>
          )}
        </div>

        {!isEmpty && (
          <div className={styles.pickerBar}>
            <DirectionPicker value={direction} onChange={setDirection} />
          </div>
        )}
      </div>

      {showOpenProject && (
        <OpenProjectDialog
          onClose={() => {
            setShowOpenProject(false);
            setOpenError(null);
          }}
          onOpen={handleOpenPath}
        />
      )}

      {showPicker && (
        <NewWorkspacePicker
          projects={data.projects}
          onClose={() => setShowPicker(false)}
          onPick={(p) => {
            setShowPicker(false);
            setCreateRepoRoot(p.path);
          }}
        />
      )}

      {createRepoRoot && (
        <CreateWorkspaceDialog
          repoRoot={createRepoRoot}
          onClose={() => setCreateRepoRoot(null)}
        />
      )}
    </div>
  );
}
