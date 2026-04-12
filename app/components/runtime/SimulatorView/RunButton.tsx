import { useCallback, useEffect, useState } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  createTerminal,
  destroyTerminal,
  readStagehandConfig,
} from "../../../lib/ipc";
import {
  startListening,
  stopListening,
} from "../../../lib/terminalBufferService";
import {
  addSession,
  getRunSessionId,
  removeSession,
  setActiveSession,
  setRunBusy,
  setRunSession,
  useRunBusy,
  useRunSessionId,
} from "../../../stores/terminalStore";
import { getWorkspaceState } from "../../../stores/workspaceStore";
import { PlayIcon } from "../../shared/Icons";
import styles from "./RunButton.module.css";

interface RunButtonProps {
  workspaceId: string;
}

export function RunButton({ workspaceId }: RunButtonProps) {
  const [runCommand, setRunCommand] = useState<string | null>(null);
  const [runDir, setRunDir] = useState<string | undefined>(undefined);
  const runSessionId = useRunSessionId(workspaceId);
  const runBusy = useRunBusy(workspaceId);

  // Load config to get the run command
  useEffect(() => {
    (async () => {
      try {
        const ws = getWorkspaceState().workspaces.find(
          (w) => w.id === workspaceId,
        );
        if (!ws) {
          return;
        }
        const config = await readStagehandConfig(ws.repo_root);
        if (!config.run) {
          setRunCommand(null);
          setRunDir(undefined);
        } else if (typeof config.run === "string") {
          setRunCommand(config.run);
          setRunDir(undefined);
        } else {
          setRunCommand(config.run.command);
          setRunDir(config.run.dir ?? undefined);
        }
      } catch {
        setRunCommand(null);
        setRunDir(undefined);
      }
    })();
  }, [workspaceId]);

  // Listen for terminal exit to clear busy state
  useIpcEvent(
    runSessionId ? `terminal:exit:${runSessionId}` : "",
    useCallback(() => {
      setRunBusy(workspaceId, false);
    }, [workspaceId]),
  );

  const handleRun = useCallback(async () => {
    if (!runCommand) {
      return;
    }
    // Destroy old run session if it exists
    const oldId = getRunSessionId(workspaceId);
    if (oldId) {
      stopListening(oldId);
      removeSession(workspaceId, oldId);
      setRunSession(workspaceId, null);
      setRunBusy(workspaceId, false);
      try {
        await destroyTerminal(oldId);
      } catch {
        // best-effort cleanup
      }
    }

    try {
      const sessionId = await createTerminal(workspaceId, runDir, runCommand);
      startListening(sessionId);
      addSession({
        id: sessionId,
        workspace_id: workspaceId,
        title: "Run",
      });
      setRunSession(workspaceId, sessionId);
      setRunBusy(workspaceId, true);
      setActiveSession(workspaceId, sessionId);
    } catch {
      // backend not ready
    }
  }, [workspaceId, runCommand, runDir]);

  if (!runCommand) {
    return null;
  }

  return (
    <button
      className={styles.runBtn}
      disabled={runBusy}
      title={runBusy ? "Running..." : runCommand}
      onClick={handleRun}
    >
      <PlayIcon size={10} />
      Run
    </button>
  );
}
