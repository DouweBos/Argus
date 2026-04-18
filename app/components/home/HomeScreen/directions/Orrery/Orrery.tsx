import type { HomeData, HomeProject } from "../../useHomeData";
import { useRef } from "react";
import { Button, Icons, PalettePill, Planet } from "@argus/peacock";
import { openCommandPalette } from "../../../../../stores/commandPaletteStore";
import styles from "./Orrery.module.css";

const TICK_CLASSES: Record<string, string> = {
  running: styles.running,
  pending: styles.pending,
  error: styles.error,
};

export interface OrreryProps {
  data: HomeData & { formatLastOpened: (ms: number) => string };
  onAddRepository: () => void;
  onNewWorkspace: () => void;
  onOpenProject: (proj: HomeProject) => void;
  onOpenWorkspace: (workspaceId: string, repoPath: string) => void;
}

export function Orrery({
  data,
  onNewWorkspace,
  onOpenProject,
  onOpenWorkspace,
}: OrreryProps) {
  const paletteRef = useRef<HTMLInputElement>(null);
  const { projects, activeAgents, stats, formatLastOpened } = data;
  const mid = Math.ceil(projects.length / 2);
  const left = projects.slice(0, mid);
  const right = projects.slice(mid);

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <Icons.ArgusLogo size={20} /> Argus
        </div>
        <div className={styles.sep} />
        <div className={styles.paletteWrap}>
          <PalettePill
            ref={paletteRef}
            onFocus={openCommandPalette}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                openCommandPalette();
              }
            }}
          />
        </div>
        <div className={styles.sep} />
        <div className={styles.rightStats}>
          <div className={styles.rs}>
            <span className={`${styles.v} ${styles.live}`}>
              {stats.agentsRunning}
            </span>{" "}
            live
          </div>
          <div className={styles.rs}>
            <span className={styles.v}>{stats.workspaces}</span> workspaces
          </div>
          <div className={styles.rs}>
            <span className={styles.v}>{stats.projects}</span> repos
          </div>
        </div>
      </div>

      <div className={styles.stage}>
        <div className={`${styles.planetCol} ${styles.planetColLeft}`}>
          {left.map((p, i) => (
            <Planet
              key={p.id}
              name={p.name}
              branch={p.workspaces[0]?.branch}
              when={formatLastOpened(p.lastOpened)}
              accent={p.accent}
              facing="right"
              agents={p.agents.map((a) => ({
                id: a.id,
                name: a.branch,
                status: a.status,
              }))}
              emptyLabel={
                p.workspaces.length > 0
                  ? "no agents · open to start"
                  : "no workspaces"
              }
              diff={{ add: 0, del: 0, files: 0 }}
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => onOpenProject(p)}
            />
          ))}
        </div>

        <div className={styles.hub}>
          <div className={styles.hubInner}>
            <Icons.ArgusLogo size={40} />
            <h1>Argus</h1>
            <div className={styles.hubTag}>
              parallel agentic mobile &amp; web dev
            </div>
            <div className={styles.hubBig}>{stats.agentsRunning}</div>
            <div className={styles.hubBigLabel}>agents live</div>
            <Button
              variant="primary"
              size="sm"
              leading={<Icons.PlusIcon size={11} />}
              onClick={onNewWorkspace}
              style={{ marginTop: 6 }}
            >
              New workspace
            </Button>
          </div>
        </div>

        <div className={`${styles.planetCol} ${styles.planetColRight}`}>
          {right.map((p, i) => (
            <Planet
              key={p.id}
              name={p.name}
              branch={p.workspaces[0]?.branch}
              when={formatLastOpened(p.lastOpened)}
              accent={p.accent}
              facing="left"
              agents={p.agents.map((a) => ({
                id: a.id,
                name: a.branch,
                status: a.status,
              }))}
              emptyLabel={
                p.workspaces.length > 0
                  ? "no agents · open to start"
                  : "no workspaces"
              }
              diff={{ add: 0, del: 0, files: 0 }}
              style={{ animationDelay: `${(i + left.length) * 60}ms` }}
              onClick={() => onOpenProject(p)}
            />
          ))}
        </div>
      </div>

      <div className={styles.bottom}>
        <span className={styles.lbl}>Pulse</span>
        <div className={styles.tickStrip}>
          {activeAgents.length === 0 ? (
            <span className={styles.tick}>
              <span className={styles.t}>idle</span>· no agents running
            </span>
          ) : (
            activeAgents.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`${styles.tick} ${TICK_CLASSES[a.status] ?? ""}`}
                onClick={() =>
                  onOpenWorkspace(a.workspace.id, a.workspace.repo_root)
                }
              >
                <span className={styles.t}>now</span>
                <span>{basename(a.workspace.repo_root)}</span>
                <span style={{ color: "var(--text-muted)" }}>/</span>
                <span>{a.branch}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
