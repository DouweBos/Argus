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
import { setActiveAgent } from "../../../stores/agentStore";
import { useDevicePoller } from "../../../stores/deviceStore";
import {
  showOpenProjectDialog,
  triggerNewWorkspace,
} from "../../../stores/dialogStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { removeRecentProject } from "../../../stores/recentProjectsStore";
import { selectWorkspace } from "../../../stores/workspaceStore";
import { DirectionPicker } from "./DirectionPicker/DirectionPicker";
import styles from "./HomeScreen.module.css";
import { CommandCenter } from "./directions/CommandCenter/CommandCenter";
import { LiveActivity } from "./directions/LiveActivity/LiveActivity";
import { Orrery } from "./directions/Orrery/Orrery";
import { HOME_SHORTCUTS, HOME_TIPS } from "./homeContent";
import { useHomeData, type HomeProject } from "./useHomeData";
import { useHomeDirection } from "./useHomeDirection";

export function HomeScreen() {
  useDevicePoller(5000);
  const data = useHomeData();
  const [direction, setDirection] = useHomeDirection();
  const { openProject } = useProjects();
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [claudeCliMissing, setClaudeCliMissing] = useState(false);

  useEffect(() => {
    checkClaudeCli()
      .then(() => setClaudeCliMissing(false))
      .catch(() => setClaudeCliMissing(true));
  }, []);

  const handleOpenProject = async (p: HomeProject) => {
    setOpenError(null);
    setOpeningPath(p.path);
    try {
      await openProject(p.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
      removeRecentProject(p.path);
    } finally {
      setOpeningPath(null);
    }
  };

  const handleOpenWorkspace = async (
    workspaceId: string,
    repoPath: string,
    agentId?: string,
  ) => {
    try {
      await openProject(repoPath, { autoSelect: false });
      selectWorkspace(workspaceId);
      if (agentId) {
        setActiveAgent(workspaceId, agentId);
        setActiveCenterView("agents");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
    }
  };

  const handleAddRepository = () => showOpenProjectDialog();
  const handleNewWorkspace = () => triggerNewWorkspace();

  const directionProps = {
    data,
    onAddRepository: handleAddRepository,
    onNewWorkspace: handleNewWorkspace,
    onOpenProject: (p: HomeProject) => {
      handleOpenProject(p).catch(() => {});
    },
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
    </div>
  );
}
