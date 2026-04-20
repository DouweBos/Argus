import type { RunCommand } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ContextMenu, Icons } from "@argus/peacock";
import { error as logError } from "@logger";
import {
  createRunTerminal,
  readArgusConfig,
  stopTerminal,
} from "../../../lib/ipc";
import {
  startListening,
  stopListening,
} from "../../../lib/terminalBufferService";
import { setActiveTool } from "../../../stores/layoutStore";
import { getSessionState } from "../../../stores/sessionStore";
import {
  addSession,
  getSessionsForSession,
  setActiveSession,
} from "../../../stores/terminalStore";
import styles from "./RunControl.module.css";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [runningTerminals, setRunningTerminals] = useState<
    Record<string, string>
  >({});

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
      } catch {
        if (!cancelled) {
          setRuns([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const runTitle = useCallback(
    async (title: string) => {
      try {
        const result = await createRunTerminal(sessionId, title);

        setRunningTerminals((prev) => ({ ...prev, [title]: result.sessionId }));

        // Register the session in the terminal store if it isn't already
        // present. When the backend reuses an existing session the same id
        // is returned — addSession would duplicate, so we dedupe here.
        const existing = getSessionsForSession(sessionId).some(
          (s) => s.id === result.sessionId,
        );
        if (!existing) {
          startListening(result.sessionId);
          addSession({
            id: result.sessionId,
            session_id: sessionId,
            title,
          });
        } else {
          startListening(result.sessionId);
        }
        setActiveSession(sessionId, result.sessionId);
        setActiveTool("terminal");

        // Drop the running marker once the pty exits, so the button flips
        // back from Stop to Play.
        const unlisten = window.argus.on<number>(
          `terminal:exit:${result.sessionId}`,
          () => {
            setRunningTerminals((prev) => {
              if (prev[title] !== result.sessionId) {
                return prev;
              }
              const { [title]: _removed, ...rest } = prev;

              return rest;
            });
            unlisten();
            stopListening(result.sessionId);
          },
        );
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

  const toggleTitle = useCallback(
    (title: string) => {
      if (runningTerminals[title]) {
        void stopTitle(title);
      } else {
        void runTitle(title);
      }
    },
    [runningTerminals, runTitle, stopTitle],
  );

  if (runs.length === 0) {
    return null;
  }

  if (runs.length === 1) {
    const only = runs[0];
    const running = Boolean(runningTerminals[only.title]);

    return (
      <Button
        leading={
          running ? <Icons.StopIcon size={10} /> : <Icons.PlayIcon size={10} />
        }
        size="sm"
        variant="primary"
        title={running ? `Stop ${only.title}` : only.command}
        onClick={() => toggleTitle(only.title)}
      >
        {running ? "Stop" : only.title}
      </Button>
    );
  }

  const first = runs[0];
  const firstRunning = Boolean(runningTerminals[first.title]);

  return (
    <div ref={anchorRef} className={styles.splitGroup}>
      <Button
        className={styles.primarySide}
        leading={
          firstRunning ? (
            <Icons.StopIcon size={10} />
          ) : (
            <Icons.PlayIcon size={10} />
          )
        }
        size="sm"
        variant="primary"
        title={firstRunning ? `Stop ${first.title}` : first.command}
        onClick={() => toggleTitle(first.title)}
      >
        {firstRunning ? "Stop" : first.title}
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
          position="anchor"
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
