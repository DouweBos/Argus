import { useState } from "react";
import {
  Banner,
  Button,
  EmptyHome,
  Icons,
  Kbd,
  ProjectCard,
} from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import { LOCAL_HOST_ID } from "../../../lib/transport/hostId";
import { useHostConnections } from "../../../stores/connectionStore";
import {
  startNewSession,
  showCliImportDialog,
  showOpenProjectDialog,
} from "../../../stores/dialogStore";
import { removeRecentProject } from "../../../stores/recentProjectsStore";
import {
  openChangelogDialog,
  useUpdaterState,
} from "../../../stores/updaterStore";
import { SetupBanners } from "../SetupBanners";
import styles from "./HomeScreen.module.css";
import { HomeUsage } from "./HomeUsage";
import { NeedsYouSection } from "./NeedsYouSection";
import { RecentRunsSection } from "./RecentRunsSection";
import { HOME_SHORTCUTS } from "./homeContent";
import { useHomeData, type HomeProject } from "./useHomeData";

export function HomeScreen() {
  const connections = useHostConnections();
  const data = useHomeData();
  const { openProject } = useProjects();
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const updater = useUpdaterState();
  const hasPendingUpdate =
    (updater.phase === "available" ||
      updater.phase === "downloading" ||
      updater.phase === "downloaded") &&
    updater.updateVersion !== null &&
    updater.updateVersion !== updater.currentVersion;

  // Only name the machine when it isn't this one — with the same repos on both
  // machines the badge is the only thing telling two cards apart.
  const hostLabelFor = (hostId: string): string | undefined =>
    hostId === LOCAL_HOST_ID
      ? undefined
      : (connections.find((c) => c.hostId === hostId)?.label ?? hostId);

  const handleOpenProject = async (p: HomeProject) => {
    setOpenError(null);
    setOpeningPath(p.path);
    try {
      await openProject(p.path, { hostId: p.hostId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOpenError(msg);
      removeRecentProject(p.path, p.hostId);
    } finally {
      setOpeningPath(null);
    }
  };

  const handleAddRepository = () => showOpenProjectDialog();

  const { projects, formatLastOpened } = data;
  const isEmpty = projects.length === 0;

  let updateLabel = "available";
  if (updater.phase === "downloaded") {
    updateLabel = "ready to install";
  } else if (updater.phase === "downloading") {
    updateLabel = `downloading (${updater.progressPercent}%)`;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {hasPendingUpdate && (
          <Banner
            tone="info"
            trailing={
              <Button variant="secondary" onClick={openChangelogDialog}>
                See changes
              </Button>
            }
          >
            <strong>Argus {updater.updateVersion}</strong> is {updateLabel}.
          </Banner>
        )}
        <SetupBanners />
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
                    variant="secondary"
                    leading={<Icons.DownloadIcon size={13} />}
                    onClick={showCliImportDialog}
                  >
                    Import from Claude Code
                  </Button>
                </>
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
            <div className={styles.wrap}>
              <div className={styles.hero}>
                <div className={styles.brandMark}>
                  <Icons.ArgusLogo size={28} />
                  <h1 className={styles.title}>Argus</h1>
                </div>
                <HomeUsage className={styles.usage} />
              </div>

              <NeedsYouSection />

              <div className={styles.section}>
                <span className={styles.eyebrow}>Recent projects</span>
                {projects.length === 0 ? (
                  <div className={styles.emptyCell}>
                    No recent projects. Open a repo to get started.
                  </div>
                ) : (
                  <div className={styles.projGrid}>
                    {projects.map((p) => (
                      <ProjectCard
                        key={p.id}
                        name={p.name}
                        path={p.path}
                        hostLabel={hostLabelFor(p.hostId)}
                        accent={p.accent}
                        agents={p.agents.map((a) => ({ status: a.status }))}
                        lastOpened={formatLastOpened(p.lastOpened)}
                        onClick={() => {
                          handleOpenProject(p).catch(() => {});
                        }}
                        onNewSession={() => {
                          startNewSession(p.path);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (
                            window.confirm(
                              `Remove ${p.name} from recent projects?`,
                            )
                          ) {
                            removeRecentProject(p.path, p.hostId);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <RecentRunsSection />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
