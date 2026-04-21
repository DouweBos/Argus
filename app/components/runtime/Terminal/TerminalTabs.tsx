import type { DropPosition } from "../../../hooks/useTabReorder";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useCloseIntent } from "../../../hooks/useCloseIntent";
import { useTabReorder } from "../../../hooks/useTabReorder";
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
  reorderSession,
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
  const containerRef = useRef<HTMLDivElement | null>(null);

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
      let opened = 0;
      try {
        const ws = getSessionState().sessions.find((w) => w.id === sessionId);
        if (ws) {
          const config = await readArgusConfig(ws.repo_root);
          for (const entry of config.terminals ?? []) {
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
              opened += 1;
            } catch {
              // skip terminals that fail (e.g. dir doesn't exist)
            }
          }
        }
      } catch {
        // no config or read failed — fall through to default terminal
      }

      if (opened === 0 && getSessionsForSession(sessionId).length === 0) {
        try {
          const terminalId = await createTerminal(sessionId);
          startListening(terminalId);
          addSession({
            id: terminalId,
            session_id: sessionId,
            title: "Shell 1",
          });
        } catch {
          // backend not ready — silently ignore
        }
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

  const handleReorder = useCallback(
    (fromId: string, targetId: string, position: DropPosition) => {
      // Never allow reordering around the pinned run tab — it is always
      // rendered first via sortedSessions.
      const currentRunId = getRunSessionId(sessionId);
      if (fromId === currentRunId || targetId === currentRunId) {
        return;
      }
      reorderSession(sessionId, fromId, targetId, position);
    },
    [sessionId],
  );

  const {
    draggingId,
    getIndicator,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useTabReorder({
    mime: "application/x-argus-terminal-tab",
    onReorder: handleReorder,
  });

  // Cmd+W: when focus is inside the terminal panel, close the active tab
  // instead of letting the agent view consume the intent. The run tab is
  // pinned and cannot be closed — still consume to avoid falling through.
  useCloseIntent(() => {
    const container = containerRef.current;
    if (!container) {
      return false;
    }
    const focused = document.activeElement;
    if (!(focused instanceof Node) || !container.contains(focused)) {
      return false;
    }
    if (!activeId) {
      return false;
    }
    if (activeId === runSessionId) {
      // Focused on the run tab — don't close it, but consume the intent.
      return true;
    }
    stopListening(activeId);
    clearBuffer(activeId);
    removeSession(sessionId, activeId);
    destroyTerminal(activeId).catch(() => {});

    return true;
  });

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
    <div ref={containerRef} className={styles.container}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {sortedSessions.map((session) => {
            const isRun = session.id === runSessionId;
            const indicator = getIndicator(session.id);
            const isDragging = draggingId === session.id;
            const classes = [
              styles.tab,
              session.id === activeId ? styles.activeTab : null,
              isRun ? styles.runTab : null,
              isDragging ? styles.dragging : null,
              indicator === "before" ? styles.dropBefore : null,
              indicator === "after" ? styles.dropAfter : null,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={session.id}
                className={classes}
                draggable={!isRun}
                onClick={() => setActiveSession(sessionId, session.id)}
                onDragStart={
                  isRun ? undefined : (e) => handleDragStart(e, session.id)
                }
                onDragEnd={isRun ? undefined : handleDragEnd}
                onDragOver={
                  isRun ? undefined : (e) => handleDragOver(e, session.id)
                }
                onDragLeave={
                  isRun ? undefined : () => handleDragLeave(session.id)
                }
                onDrop={isRun ? undefined : (e) => handleDrop(e, session.id)}
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
