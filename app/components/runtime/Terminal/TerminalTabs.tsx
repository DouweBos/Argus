import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTerminal,
  destroyTerminal,
  readArgusConfig,
} from "../../../lib/ipc";
import {
  startListening,
  stopListening,
} from "../../../lib/terminalBufferService";
import {
  addSession,
  clearBuffer,
  getRunSessionId,
  getSessionsForWorkspace,
  removeSession,
  setActiveSession,
  useActiveSessionId,
  useRunSessionId,
  useTerminalSessionsSlice,
} from "../../../stores/terminalStore";
import { getWorkspaceState } from "../../../stores/workspaceStore";
import { CloseIcon, PlayIcon, TerminalIcon } from "../../shared/Icons";
import { ShellTerminal } from "./ShellTerminal";
import styles from "./TerminalTabs.module.css";

interface TerminalTabsProps {
  workspaceId: string;
}

export function TerminalTabs({ workspaceId }: TerminalTabsProps) {
  const sessions = useTerminalSessionsSlice(workspaceId);
  const activeId = useActiveSessionId(workspaceId);
  const runSessionId = useRunSessionId(workspaceId);
  const [isCreating, setIsCreating] = useState(false);
  const autoOpenedRef = useRef<Set<string>>(new Set());

  // Sort sessions so the run tab is always first
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.id === runSessionId) {
      return -1;
    }
    if (b.id === runSessionId) {
      return 1;
    }

    return 0;
  });

  // Auto-open terminals from config when workspace is first selected
  useEffect(() => {
    if (autoOpenedRef.current.has(workspaceId)) {
      return;
    }
    const existingSessions = getSessionsForWorkspace(workspaceId);
    if (existingSessions.length > 0) {
      autoOpenedRef.current.add(workspaceId);

      return;
    }

    autoOpenedRef.current.add(workspaceId);

    (async () => {
      try {
        const ws = getWorkspaceState().workspaces.find(
          (w) => w.id === workspaceId,
        );
        if (!ws) {
          return;
        }
        const config = await readArgusConfig(ws.repo_root);
        if (!config.terminals?.length) {
          return;
        }

        for (const entry of config.terminals) {
          try {
            const sessionId = await createTerminal(
              workspaceId,
              entry.dir || undefined,
            );
            startListening(sessionId);
            addSession({
              id: sessionId,
              workspace_id: workspaceId,
              title: entry.name || entry.dir || "Shell",
            });
          } catch {
            // skip terminals that fail (e.g. dir doesn't exist)
          }
        }
      } catch {
        // no config or read failed — silently ignore
      }
    })();
  }, [workspaceId]);

  const handleCreate = useCallback(async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    try {
      const sessionId = await createTerminal(workspaceId);
      startListening(sessionId);
      addSession({
        id: sessionId,
        workspace_id: workspaceId,
        title: `Shell ${sessions.length + 1}`,
      });
    } catch {
      // backend not ready — silently ignore
    } finally {
      setIsCreating(false);
    }
  }, [workspaceId, sessions.length, isCreating]);

  const handleClose = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      stopListening(sessionId);
      clearBuffer(sessionId);
      removeSession(workspaceId, sessionId);
      try {
        await destroyTerminal(sessionId);
      } catch {
        // best-effort cleanup
      }
    },
    [workspaceId],
  );

  const handleExit = useCallback(
    (sessionId: string) => {
      // Don't auto-remove the run terminal on exit — keep output visible
      const currentRunId = getRunSessionId(workspaceId);
      if (sessionId === currentRunId) {
        return;
      }
      removeSession(workspaceId, sessionId);
    },
    [workspaceId],
  );

  return (
    <div className={styles.container}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {sortedSessions.map((session) => {
            const isRun = session.id === runSessionId;

            return (
              <button
                key={session.id}
                className={`${styles.tab} ${session.id === activeId ? styles.activeTab : ""} ${isRun ? styles.runTab : ""}`}
                onClick={() => setActiveSession(workspaceId, session.id)}
              >
                {isRun ? <PlayIcon /> : <TerminalIcon />}
                <span className={styles.tabTitle}>{session.title}</span>
                {!isRun && (
                  <span
                    aria-label={`Close ${session.title}`}
                    className={styles.tabClose}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleClose(e, session.id)}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      handleClose(e as unknown as React.MouseEvent, session.id)
                    }
                  >
                    <CloseIcon size={10} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          aria-label="New terminal"
          className={styles.addTabBtn}
          disabled={isCreating}
          title="New terminal"
          onClick={handleCreate}
        >
          {isCreating ? "…" : "+"}
        </button>
      </div>

      {/* Terminal content */}
      <div className={styles.content}>
        {sessions.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>No terminals open.</p>
            <button className={styles.newTermBtn} onClick={handleCreate}>
              <TerminalIcon /> New Terminal
            </button>
          </div>
        ) : (
          sortedSessions.map((session) => {
            const isActive = session.id === activeId;

            return (
              <div
                key={session.id}
                className={`${styles.terminalWrapper} ${isActive ? styles.terminalWrapperActive : ""}`}
              >
                <ShellTerminal
                  sessionId={session.id}
                  onExit={() => handleExit(session.id)}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
