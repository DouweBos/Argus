/**
 * Phase 4 H9 — read-only reflog view.
 *
 * Session scope: read-only recovery surface (the user can copy a hash and
 * ask the agent to recover from it). Project-scope destructive actions
 * (Reset HEAD here, Cherry-pick to current branch) appear here as
 * **disabled stubs** with a tooltip — Phase 6 P13 wires them.
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  ContextMenu,
  DestructiveConfirm,
  GitErrorBanner,
  GitSkeleton,
  ResetDialog,
  type ContextMenuItem,
  type ResetDialogResult,
} from "@argus/peacock";
import { parseDiff, type DiffFile } from "../../../../lib/diffParser";
import { GitError } from "../../../../lib/gitError";
import {
  gitCherryPick,
  gitDiffRange,
  gitReflog,
  gitReset,
  type ReflogEntry,
} from "../../../../lib/ipc";
import { FileDiffView } from "../../FileDiffView";
import { ViewHeader } from "../ViewHeader";
import styles from "./ReflogView.module.css";

export interface ReflogViewProps {
  scope: "project" | "session";
  sessionId: string;
}

interface MenuState {
  entry: ReflogEntry;
  x: number;
  y: number;
}

const SESSION_TOOLTIP = "Project-scope only";

function relativeTime(iso: string): string {
  if (!iso) {
    return "";
  }
  try {
    const ts = new Date(iso).getTime();
    const delta = Date.now() - ts;
    if (delta < 60_000) {
      return "just now";
    }
    if (delta < 3_600_000) {
      return `${Math.floor(delta / 60_000)}m ago`;
    }
    if (delta < 86_400_000) {
      return `${Math.floor(delta / 3_600_000)}h ago`;
    }

    return `${Math.floor(delta / 86_400_000)}d ago`;
  } catch {
    return iso;
  }
}

export function ReflogView({ sessionId, scope }: ReflogViewProps) {
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [resetTarget, setResetTarget] = useState<ReflogEntry | null>(null);
  const [cherryPickTarget, setCherryPickTarget] = useState<ReflogEntry | null>(
    null,
  );
  const [opError, setOpError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect --
       Async data fetch on session change. */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    gitReflog(sessionId, { limit: 200 })
      .then((res) => {
        if (cancelled) {
          return;
        }
        setEntries(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const select = async (i: number): Promise<void> => {
    setSelectedIdx(i);
    const e = entries[i];
    if (!e) {
      setDiffFiles([]);

      return;
    }
    try {
      const res = await gitDiffRange(sessionId, e.hash, "HEAD");
      const parsed: DiffFile[] = [];
      for (const f of res.files) {
        if (!f.patch) {
          continue;
        }
        for (const d of parseDiff(f.patch)) {
          parsed.push(d);
        }
      }
      setDiffFiles(parsed);
    } catch {
      setDiffFiles([]);
    }
  };

  const openMenu = (e: React.MouseEvent, entry: ReflogEntry): void => {
    e.preventDefault();
    setMenu({ entry, x: e.clientX, y: e.clientY });
  };

  const buildMenu = (entry: ReflogEntry): ContextMenuItem[] => [
    {
      label: "Copy hash",
      onClick: () =>
        navigator.clipboard?.writeText(entry.hash).catch(() => undefined),
    },
    {
      label: "Copy ref name",
      onClick: () =>
        navigator.clipboard?.writeText(entry.refName).catch(() => undefined),
    },
    { separator: true },
    {
      label:
        scope === "project" ? (
          "Reset HEAD here…"
        ) : (
          <span title={SESSION_TOOLTIP}>Reset HEAD here</span>
        ),
      disabled: scope === "session",
      onClick: () => {
        if (scope === "project") {
          setResetTarget(entry);
        }
      },
    },
    {
      label:
        scope === "project" ? (
          "Cherry-pick to current branch"
        ) : (
          <span title={SESSION_TOOLTIP}>Cherry-pick to current branch</span>
        ),
      disabled: scope === "session",
      onClick: () => {
        if (scope === "project") {
          setCherryPickTarget(entry);
        }
      },
    },
  ];

  if (loading) {
    return <GitSkeleton variant="commit-log" />;
  }

  if (error) {
    return <GitErrorBanner kind="unknown" message={error} />;
  }

  return (
    <div className={styles.outer}>
      <ViewHeader title="Reflog" subtitle={`${entries.length} entries`} />
      <div className={styles.container}>
        <div className={styles.list}>
          <div className={styles.note}>
            Read-only recovery view. Copy a hash and ask the agent to recover.
          </div>
          {entries.map((e, i) => (
            <button
              key={`${e.refName}-${i}`}
              className={`${styles.row} ${i === selectedIdx ? styles.rowActive : ""}`}
              onClick={() => select(i)}
              onContextMenu={(ev) => openMenu(ev, e)}
            >
              <Badge tone="neutral">{e.action || "?"}</Badge>
              <span className={styles.subject}>{e.subject}</span>
              <span className={styles.refName}>{e.refName}</span>
              <span className={styles.hash}>{e.hash.slice(0, 7)}</span>
              <span className={styles.time}>{relativeTime(e.timestamp)}</span>
            </button>
          ))}
          {entries.length === 0 && (
            <div className={styles.empty}>No reflog entries</div>
          )}
        </div>

        <div className={styles.detail}>
          {selectedIdx < 0 && (
            <div className={styles.empty}>
              Select an entry to see its diff vs HEAD
            </div>
          )}
          {selectedIdx >= 0 && diffFiles.length === 0 && (
            <div className={styles.empty}>No differences vs HEAD</div>
          )}
          {diffFiles.map((f, i) => (
            <FileDiffView
              key={i}
              file={f}
              inline
              sessionId={sessionId}
              onAction={async () => undefined}
            />
          ))}
        </div>

        {menu && (
          <ContextMenu
            items={buildMenu(menu.entry)}
            position={{ x: menu.x, y: menu.y }}
            onClose={() => setMenu(null)}
          />
        )}

        {opError && (
          <GitErrorBanner
            kind="unknown"
            message={opError}
            onDismiss={() => setOpError(null)}
          />
        )}

        {resetTarget && (
          <ResetDialog
            open
            targetRef={resetTarget.hash.slice(0, 7)}
            targetSubject={resetTarget.subject}
            onCancel={() => setResetTarget(null)}
            onConfirm={async (r: ResetDialogResult) => {
              const target = resetTarget;
              setResetTarget(null);
              if (!target) {
                return;
              }
              try {
                await gitReset(sessionId, { ref: target.hash, mode: r.mode });
              } catch (err) {
                setOpError(err instanceof GitError ? err.message : String(err));
              }
            }}
          />
        )}

        <DestructiveConfirm
          open={Boolean(cherryPickTarget)}
          title="Cherry-pick onto current branch?"
          description={
            cherryPickTarget
              ? `Apply ${cherryPickTarget.hash.slice(0, 7)} — ${cherryPickTarget.subject}`
              : ""
          }
          confirmLabel="Cherry-pick"
          tone="warning"
          onConfirm={async () => {
            const target = cherryPickTarget;
            setCherryPickTarget(null);
            if (!target) {
              return;
            }
            try {
              await gitCherryPick(sessionId, { hash: target.hash });
            } catch (err) {
              setOpError(err instanceof GitError ? err.message : String(err));
            }
          }}
          onCancel={() => setCherryPickTarget(null)}
        />

        {scope === "project" && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.hidden}
            onClick={() => undefined}
          >
            {/* Reserved for future toolbar */}
          </Button>
        )}
      </div>
    </div>
  );
}
