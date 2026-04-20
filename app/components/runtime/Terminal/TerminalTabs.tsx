import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import {
  createTerminal,
  destroyTerminal,
  readArgusConfig,
  stopTerminal,
} from "../../../lib/ipc";
import {
  startListening,
  stopListening,
} from "../../../lib/terminalBufferService";
import { getSessionState } from "../../../stores/sessionStore";
import {
  addSession,
  clearBuffer,
  getRunSessionId,
  getSessionsForSession,
  removeSession,
  setActiveSession,
  useActiveSessionId,
  useRunSessionId,
  useSessionAlive,
  useTerminalSessionsSlice,
} from "../../../stores/terminalStore";
import { ShellTerminal } from "./ShellTerminal";
import styles from "./TerminalTabs.module.css";

interface TerminalTabsProps {
  sessionId: string;
}

export function TerminalTabs({ sessionId }: TerminalTabsProps) {
  const sessions = useTerminalSessionsSlice(sessionId);
  const activeId = useActiveSessionId(sessionId);
  const runSessionId = useRunSessionId(sessionId);
  const activeAlive = useSessionAlive(activeId);
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

  // Auto-open terminals from config when session is first selected
  useEffect(() => {
    if (autoOpenedRef.current.has(sessionId)) {
      return;
    }
    const existingSessions = getSessionsForSession(sessionId);
    if (existingSessions.length > 0) {
      autoOpenedRef.current.add(sessionId);

      return;
    }

    autoOpenedRef.current.add(sessionId);

    (async () => {
      try {
        const ws = getSessionState().sessions.find(
          (w) => w.id === sessionId,
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
            const terminalId = await createTerminal(
              sessionId,
              entry.dir || undefined,
            );
            startListening(terminalId);
            addSession({
              id: terminalId,
              session_id: sessionId,
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
  }, [sessionId]);

  const handleCreate = useCallback(async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    try {
      const terminalId = await createTerminal(sessionId);
      startListening(terminalId);
      addSession({
        id: terminalId,
        session_id: sessionId,
        title: `Shell ${sessions.length + 1}`,
      });
    } catch {
      // backend not ready — silently ignore
    } finally {
      setIsCreating(false);
    }
  }, [sessionId, sessions.length, isCreating]);

  const handleClose = useCallback(
    async (e: React.MouseEvent, terminalId: string) => {
      e.stopPropagation();
      stopListening(terminalId);
      clearBuffer(terminalId);
      removeSession(sessionId, terminalId);
      try {
        await destroyTerminal(terminalId);
      } catch {
        // best-effort cleanup
      }
    },
    [sessionId],
  );

  const handleStop = useCallback(async () => {
    if (!activeId) {
      return;
    }
    try {
      await stopTerminal(activeId);
    } catch {
      // Session already gone — UI will catch up via the exit event.
    }
  }, [activeId]);

  const handleExit = useCallback(
    (terminalId: string) => {
      // Don't auto-remove the run terminal on exit — keep output visible
      const currentRunId = getRunSessionId(sessionId);
      if (terminalId === currentRunId) {
        return;
      }
      removeSession(sessionId, terminalId);
    },
    [sessionId],
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
                onClick={() => setActiveSession(sessionId, session.id)}
              >
                {isRun ? (
                  <Icons.PlayIcon size={11} />
                ) : (
                  <Icons.TerminalIcon size={11} />
                )}
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
                    <Icons.CloseIcon size={10} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {activeAlive && (
          <button
            aria-label="Stop terminal process"
            className={styles.stopBtn}
            title="Stop (SIGINT → SIGTERM → SIGKILL)"
            onClick={handleStop}
          >
            <Icons.StopIcon size={10} />
          </button>
        )}
        <button
          aria-label="New terminal"
          className={styles.addTabBtn}
          disabled={isCreating}
          title="New terminal"
          onClick={handleCreate}
        >
          {isCreating ? (
            <Icons.EllipsisIcon size={10} />
          ) : (
            <Icons.PlusIcon size={11} />
          )}
        </button>
      </div>

      {/* Terminal content */}
      <div className={styles.content}>
        {sessions.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>No terminals open.</p>
            <Button
              leading={<Icons.TerminalIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleCreate}
            >
              New Terminal
            </Button>
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
                  isActive={isActive}
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
