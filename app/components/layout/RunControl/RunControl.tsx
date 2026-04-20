import type { RunCommand } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ContextMenu, Icons } from "@argus/peacock";
import { error as logError } from "@logger";
import { createRunTerminal, readArgusConfig } from "../../../lib/ipc";
import {
  startListening,
  stopListening,
} from "../../../lib/terminalBufferService";
import { setActiveTool } from "../../../stores/layoutStore";
import {
  addSession,
  getSessionsForWorkspace,
  setActiveSession,
} from "../../../stores/terminalStore";
import { getWorkspaceState } from "../../../stores/workspaceStore";
import styles from "./RunControl.module.css";

interface RunControlProps {
  workspaceId: string;
}

/**
 * Standalone run button that sits in the app TitleBar, replacing the old
 * in-simulator run button. Reads the workspace's `run` array from
 * `.argus.json` and either shows a single play button or a split-button
 * menu when more than one command is configured.
 */
export function RunControl({ workspaceId }: RunControlProps) {
  const [runs, setRuns] = useState<RunCommand[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [busyTitles, setBusyTitles] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = getWorkspaceState().workspaces.find(
          (w) => w.id === workspaceId,
        );
        if (!ws) {
          return;
        }
        const config = await readArgusConfig(ws.repo_root);
        if (cancelled) {
          return;
        }
        setRuns(Array.isArray(config.run) ? config.run : []);
      } catch {
        if (!cancelled) {
          setRuns([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const runTitle = useCallback(
    async (title: string) => {
      try {
        setBusyTitles((prev) => new Set(prev).add(title));
        const result = await createRunTerminal(workspaceId, title);

        // Register the session in the terminal store if it isn't already
        // present. When the backend reuses an existing session the same id
        // is returned — addSession would duplicate, so we dedupe here.
        const existing = getSessionsForWorkspace(workspaceId).some(
          (s) => s.id === result.sessionId,
        );
        if (!existing) {
          startListening(result.sessionId);
          addSession({
            id: result.sessionId,
            workspace_id: workspaceId,
            title,
          });
        } else {
          startListening(result.sessionId);
        }
        setActiveSession(workspaceId, result.sessionId);
        setActiveTool("terminal");

        // Best-effort listen-for-exit so the UI can drop the busy indicator.
        const unlisten = window.argus.on<number>(
          `terminal:exit:${result.sessionId}`,
          () => {
            setBusyTitles((prev) => {
              const next = new Set(prev);
              next.delete(title);

              return next;
            });
            unlisten();
            stopListening(result.sessionId);
          },
        );
      } catch (e) {
        logError("run failed:", e);
      } finally {
        setBusyTitles((prev) => {
          if (!prev.has(title)) {
            return prev;
          }
          const next = new Set(prev);
          // Keep busy while the session is alive — the exit listener above
          // clears it. But if createRunTerminal itself threw we should clear
          // on failure; the finally block runs before the exit event, so we
          // only leave it set when a sessionId was actually returned. A
          // dropped error means the Set entry stays; schedule a clear.
          setTimeout(() => {
            setBusyTitles((p) => {
              const n = new Set(p);
              n.delete(title);

              return n;
            });
          }, 150);

          return next;
        });
      }
    },
    [workspaceId],
  );

  if (runs.length === 0) {
    return null;
  }

  if (runs.length === 1) {
    const only = runs[0];
    const busy = busyTitles.has(only.title);

    return (
      <Button
        leading={<Icons.PlayIcon size={10} />}
        size="sm"
        variant="primary"
        title={busy ? `${only.title} running…` : only.command}
        onClick={() => runTitle(only.title)}
      >
        {only.title}
      </Button>
    );
  }

  const first = runs[0];
  const firstBusy = busyTitles.has(first.title);

  return (
    <div ref={anchorRef} className={styles.splitGroup}>
      <Button
        className={styles.primarySide}
        leading={<Icons.PlayIcon size={10} />}
        size="sm"
        variant="primary"
        title={firstBusy ? `${first.title} running…` : first.command}
        onClick={() => runTitle(first.title)}
      >
        {first.title}
      </Button>
      <Button
        aria-label="Show run commands"
        className={styles.chevronSide}
        size="sm"
        variant="primary"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Icons.ChevronDownIcon size={10} />
      </Button>
      {menuOpen && (
        <ContextMenu
          items={runs.map((r) => ({
            label: busyTitles.has(r.title) ? `${r.title} · running` : r.title,
            icon: <Icons.PlayIcon size={10} />,
            onClick: () => runTitle(r.title),
          }))}
          position="anchor"
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
