import type { DependencyStatus } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Banner, Button, EmptyHome, Icons, Kbd } from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import { checkDependencies } from "../../../lib/ipc";
import { setActiveAgent } from "../../../stores/agentStore";
import { useDevicePoller } from "../../../stores/deviceStore";
import {
  showOpenProjectDialog,
  triggerNewSession,
} from "../../../stores/dialogStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { useOrganizationSync } from "../../../stores/organizationStore";
import { removeRecentProject } from "../../../stores/recentProjectsStore";
import { selectSession } from "../../../stores/sessionStore";
import { OrganizationDialogHost } from "../OrganizationDialog/OrganizationDialog";
import styles from "./HomeScreen.module.css";
import { CommandCenter } from "./directions/CommandCenter/CommandCenter";
import { HOME_SHORTCUTS } from "./homeContent";
import { useHomeData, type HomeProject } from "./useHomeData";

export function HomeScreen() {
  useDevicePoller(5000);
  useOrganizationSync();
  const data = useHomeData();
  const { openProject } = useProjects();
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [missingDeps, setMissingDeps] = useState<DependencyStatus[]>([]);

  useEffect(() => {
    checkDependencies()
      .then((report) =>
        setMissingDeps(report.dependencies.filter((d) => !d.installed)),
      )
      .catch(() => setMissingDeps([]));
  }, []);

  const missingRequired = missingDeps.filter((d) => d.severity === "required");
  const missingOptional = missingDeps.filter((d) => d.severity === "optional");

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

  const handleOpenSession = async (
    sessionId: string,
    repoPath: string,
    agentId?: string,
  ) => {
    try {
      await openProject(repoPath, { autoSelect: false });
      selectSession(sessionId);
      if (agentId) {
        setActiveAgent(sessionId, agentId);
        setActiveCenterView("agents");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
    }
  };

  const handleAddRepository = () => showOpenProjectDialog();
  const handleNewSession = () => triggerNewSession();

  const directionProps = {
    data,
    onAddRepository: handleAddRepository,
    onNewSession: handleNewSession,
    onOpenProject: (p: HomeProject) => {
      handleOpenProject(p).catch(() => {});
    },
    onOpenSession: handleOpenSession,
  };

  const isEmpty = data.projects.length === 0;

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {missingRequired.map((dep) => (
          <Banner key={dep.id} tone="error">
            <strong>{dep.name}</strong> not found. {dep.purpose} {dep.hint}
          </Banner>
        ))}
        {missingOptional.map((dep) => (
          <Banner key={dep.id} tone="warning">
            <strong>{dep.name}</strong> not found. {dep.purpose} {dep.hint}
          </Banner>
        ))}
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
                <Button
                  variant="primary"
                  leading={<Icons.FolderIcon size={13} />}
                  onClick={handleAddRepository}
                >
                  Add repository
                </Button>
              }
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
            <CommandCenter {...directionProps} />
          )}
        </div>
      </div>
      <OrganizationDialogHost />
    </div>
  );
}
