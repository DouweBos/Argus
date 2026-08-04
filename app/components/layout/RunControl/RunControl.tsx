import type { RunCommand } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ConfirmDialog, ContextMenu, Icons } from "@argus/peacock";
import { error as logError } from "@logger";
import { useArgusConfigVersion } from "../../../hooks/useArgusConfigVersion";
import {
  createRunTerminal,
  listTerminals,
  readArgusConfig,
  stopTerminal,
} from "../../../lib/ipc";
import { registerRunTerminal } from "../../../lib/runRegistration";
import { stopListening } from "../../../lib/terminalBufferService";
import { getSessionState, useSessions } from "../../../stores/sessionStore";
import {
  clearRunningTerminalIfMatches,
  getTerminalState,
  setRunningTerminal,
  useRunningTerminalsForSession,
} from "../../../stores/terminalStore";
import styles from "./RunControl.module.css";

interface ConflictingRuntime {
  sessionId: string;
  sessionName: string;
  terminalId: string;
  title: string;
}

interface RunControlProps {
  sessionId: string;
}

/**
 * Standalone run button that sits in the app TitleBar, replacing the old
 * in-simulator run button. Reads the session's `run` array from
 * `.argus.json` and either shows a single play button or a split-button
 * menu when more than one command is configured.
 */
export function RunControl({ sessionId }: RunControlProps) {
  const [runs, setRuns] = useState<RunCommand[]>([]);
  const [singleRuntime, setSingleRuntime] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    conflicts: ConflictingRuntime[];
    title: string;
  } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const runningTerminals = useRunningTerminalsForSession(sessionId);
  const allSessions = useSessions();
  const repoRoot =
    allSessions.find((w) => w.id === sessionId)?.repo_root ?? null;
  const configVersion = useArgusConfigVersion(repoRoot);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = getSessionState().sessions.find((w) => w.id === sessionId);
        if (!ws) {
          return;
        }
        const config = await readArgusConfig(ws.repo_root);
        if (cancelled) {
          return;
        }
        setRuns(Array.isArray(config.run) ? config.run : []);
        setSingleRuntime(Boolean(config.single_runtime));
      } catch {
        if (!cancelled) {
          setRuns([]);
          setSingleRuntime(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, configVersion]);

  // Rehydrate the running-run marker after a window reload. PTYs persist in
  // main, so a dev server kicked off before the reload is still alive — but
  // the renderer's runningTerminals map (and the exit listener that flips
  // the button back to Play) are gone unless we reattach.
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    (async () => {
      try {
        const live = await listTerminals(sessionId);
        if (cancelled) {
          return;
        }
        for (const t of live) {
          if (!t.runTitle) {
            continue;
          }
          if (getTerminalState().runningTerminals[sessionId]?.[t.runTitle]) {
            continue;
          }
          setRunningTerminal(sessionId, t.runTitle, t.id);
          const runTitle = t.runTitle;
          const terminalId = t.id;
          const unlisten = window.argus.on<number>(
            `terminal:exit:${terminalId}`,
            () => {
              clearRunningTerminalIfMatches(sessionId, runTitle, terminalId);
              unlisten();
              stopListening(terminalId);
            },
          );
          unlisteners.push(unlisten);
        }
      } catch {
        // backend not ready — non-fatal.
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unlisteners) {
        u();
      }
    };
  }, [sessionId]);

  const runTitle = useCallback(
    async (title: string) => {
      try {
        const result = await createRunTerminal(sessionId, title);
        registerRunTerminal({
          sessionId,
          title,
          terminalSessionId: result.sessionId,
          dependencies: result.dependencies.map((d) => ({
            sessionId: d.sessionId,
            title: d.title,
          })),
        });
      } catch (e) {
        logError("run failed:", e);
      }
    },
    [sessionId],
  );

  const stopTitle = useCallback(
    async (title: string) => {
      const terminalId = runningTerminals[title];
      if (!terminalId) {
        return;
      }
      try {
        await stopTerminal(terminalId);
      } catch (e) {
        logError("stop failed:", e);
      }
    },
    [runningTerminals],
  );

  const findConflictingRuntimes = useCallback((): ConflictingRuntime[] => {
    const sessions = getSessionState().sessions;
    const currentSession = sessions.find((s) => s.id === sessionId);
    if (!currentSession) {
      return [];
    }
    const allRunning = getTerminalState().runningTerminals;
    const conflicts: ConflictingRuntime[] = [];
    for (const [otherSessionId, sessionRuns] of Object.entries(allRunning)) {
      if (otherSessionId === sessionId) {
        continue;
      }
      const otherSession = sessions.find((s) => s.id === otherSessionId);
      if (!otherSession) {
        continue;
      }
      if (otherSession.repo_root !== currentSession.repo_root) {
        continue;
      }
      for (const [title, terminalId] of Object.entries(sessionRuns)) {
        conflicts.push({
          sessionId: otherSessionId,
          sessionName:
            otherSession.display_name ?? otherSession.branch ?? otherSessionId,
          terminalId,
          title,
        });
      }
    }

    return conflicts;
  }, [sessionId]);

  const toggleTitle = useCallback(
    (title: string) => {
      if (runningTerminals[title]) {
        stopTitle(title).catch(() => undefined);

        return;
      }
      if (singleRuntime) {
        const conflicts = findConflictingRuntimes();
        if (conflicts.length > 0) {
          setPendingConflict({ conflicts, title });

          return;
        }
      }
      runTitle(title).catch(() => undefined);
    },
    [
      runningTerminals,
      runTitle,
      stopTitle,
      singleRuntime,
      findConflictingRuntimes,
    ],
  );

  const handleConfirmStopAndRun = useCallback(async () => {
    if (!pendingConflict) {
      return;
    }
    const { conflicts, title } = pendingConflict;
    // `stopTerminal` only sends signals and returns immediately, but the
    // child (e.g. a dev server holding port 1420) may take a moment to
    // actually release its resources. Wait for the `terminal:exit` event
    // before spawning the replacement, otherwise the new run races against
    // the old one and dies on "port already in use".
    await Promise.all(
      conflicts.map(
        (c) =>
          new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              unlisten();
              resolve();
            }, 8000);
            const unlisten = window.argus.on<number>(
              `terminal:exit:${c.terminalId}`,
              () => {
                clearTimeout(timeout);
                unlisten();
                resolve();
              },
            );
            stopTerminal(c.terminalId).catch((e) => {
              logError("stop other runtime failed:", e);
              clearTimeout(timeout);
              unlisten();
              resolve();
            });
          }),
      ),
    );
    setPendingConflict(null);
    runTitle(title).catch(() => undefined);
  }, [pendingConflict, runTitle]);

  const conflictDialog = pendingConflict ? (
    <ConfirmDialog
      cancelLabel="Cancel"
      confirmLabel="Stop other & run"
      destructive
      title="Another runtime is running"
      titleId="single-runtime-conflict"
      onCancel={() => setPendingConflict(null)}
      onConfirm={handleConfirmStopAndRun}
    >
      <p>
        This project allows only one runtime at a time. The following{" "}
        {pendingConflict.conflicts.length === 1 ? "runtime is" : "runtimes are"}{" "}
        still active:
      </p>
      <ul>
        {pendingConflict.conflicts.map((c) => (
          <li key={`${c.sessionId}:${c.title}`}>
            <strong>{c.title}</strong> in <em>{c.sessionName}</em>
          </li>
        ))}
      </ul>
      <p>
        Stop {pendingConflict.conflicts.length === 1 ? "it" : "them"} and start{" "}
        <strong>{pendingConflict.title}</strong> here?
      </p>
    </ConfirmDialog>
  ) : null;

  if (runs.length === 0) {
    return conflictDialog;
  }

  if (runs.length === 1) {
    const only = runs[0];
    const running = Boolean(runningTerminals[only.title]);

    return (
      <>
        <Button
          leading={
            running ? (
              <Icons.StopIcon size={10} />
            ) : (
              <Icons.PlayIcon size={10} />
            )
          }
          size="sm"
          variant="primary"
          title={running ? `Stop ${only.title}` : only.command}
          onClick={() => toggleTitle(only.title)}
        >
          {running ? `Stop ${only.title}` : only.title}
        </Button>
        {conflictDialog}
      </>
    );
  }

  const primary = runs.find((r) => runningTerminals[r.title]) ?? runs[0];
  const primaryRunning = Boolean(runningTerminals[primary.title]);

  return (
    <div ref={anchorRef} className={styles.splitGroup}>
      <Button
        className={styles.primarySide}
        leading={
          primaryRunning ? (
            <Icons.StopIcon size={10} />
          ) : (
            <Icons.PlayIcon size={10} />
          )
        }
        size="sm"
        variant="primary"
        title={primaryRunning ? `Stop ${primary.title}` : primary.command}
        onClick={() => toggleTitle(primary.title)}
      >
        {primaryRunning ? `Stop ${primary.title}` : primary.title}
      </Button>
      <Button
        aria-label="Show run commands"
        className={styles.chevronSide}
        size="sm"
        variant="primary"
        onClick={() => {
          setMenuPosition((prev) => {
            if (prev) {
              return null;
            }
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) {
              return null;
            }

            return { x: rect.right - 200, y: rect.bottom + 4 };
          });
        }}
      >
        <Icons.ChevronDownIcon size={10} />
      </Button>
      {menuPosition && (
        <ContextMenu
          items={runs.map((r) => {
            const running = Boolean(runningTerminals[r.title]);

            return {
              label: running ? `Stop ${r.title}` : r.title,
              icon: running ? (
                <Icons.StopIcon size={10} />
              ) : (
                <Icons.PlayIcon size={10} />
              ),
              onClick: () => toggleTitle(r.title),
            };
          })}
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          triggerRef={anchorRef}
        />
      )}
      {conflictDialog}
    </div>
  );
}
