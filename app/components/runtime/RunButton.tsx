import { useState, useEffect, useCallback } from "react";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  createTerminal,
  destroyTerminal,
  readStagehandConfig,
} from "../../lib/ipc";
import { startListening, stopListening } from "../../lib/terminalBufferService";
import { useIpcEvent } from "../../hooks/useIpcEvent";
import { PlayIcon } from "../shared/Icons";
import styles from "./RunButton.module.css";

interface RunButtonProps {
  workspaceId: string;
}

export function RunButton({ workspaceId }: RunButtonProps) {
  const [runCommand, setRunCommand] = useState<null | string>(null);
  const [runDir, setRunDir] = useState<string | undefined>(undefined);
  const runSessionId = useTerminalStore(
    (s) => s.runSessionId[workspaceId] ?? null,
  );
  const runBusy = useTerminalStore((s) => s.runBusy[workspaceId] ?? false);

  // Load config to get the run command
  useEffect(() => {
    (async () => {
      try {
        const ws = useWorkspaceStore
          .getState()
          .workspaces.find((w) => w.id === workspaceId);
        if (!ws) return;
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
      useTerminalStore.getState().setRunBusy(workspaceId, false);
    }, [workspaceId]),
  );

  const handleRun = useCallback(async () => {
    if (!runCommand) return;
    const store = useTerminalStore.getState();

    // Destroy old run session if it exists
    const oldId = store.getRunSessionId(workspaceId);
    if (oldId) {
      stopListening(oldId);
      store.removeSession(workspaceId, oldId);
      store.setRunSession(workspaceId, null);
      store.setRunBusy(workspaceId, false);
      try {
        await destroyTerminal(oldId);
      } catch {
        // best-effort cleanup
      }
    }

    try {
      const sessionId = await createTerminal(workspaceId, runDir, runCommand);
      startListening(sessionId);
      store.addSession({
        id: sessionId,
        workspace_id: workspaceId,
        title: "Run",
      });
      store.setRunSession(workspaceId, sessionId);
      store.setRunBusy(workspaceId, true);
      store.setActiveSession(workspaceId, sessionId);
    } catch {
      // backend not ready
    }
  }, [workspaceId, runCommand, runDir]);

  if (!runCommand) return null;

  return (
    <button
      className={styles.runBtn}
      onClick={handleRun}
      disabled={runBusy}
      title={runBusy ? "Running..." : runCommand}
    >
      <PlayIcon size={10} />
      Run
    </button>
  );
}
