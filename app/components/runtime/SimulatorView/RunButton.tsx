import { useCallback, useEffect, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  createRunTerminal,
  destroyTerminal,
  readArgusConfig,
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

interface RunButtonProps {
  workspaceId: string;
}

export function RunButton({ workspaceId }: RunButtonProps) {
  const [runCommand, setRunCommand] = useState<string | null>(null);
  const runSessionId = useRunSessionId(workspaceId);
  const runBusy = useRunBusy(workspaceId);

  // Load config to display the run command in the button title. The command
  // itself is resolved server-side by createRunTerminal — we only need the
  // string here for the tooltip.
  useEffect(() => {
    (async () => {
      try {
        const ws = getWorkspaceState().workspaces.find(
          (w) => w.id === workspaceId,
        );
        if (!ws) {
          return;
        }
        const config = await readArgusConfig(ws.repo_root);
        if (!config.run) {
          setRunCommand(null);
        } else if (typeof config.run === "string") {
          setRunCommand(config.run);
        } else {
          setRunCommand(config.run.command);
        }
      } catch {
        setRunCommand(null);
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
      const sessionId = await createRunTerminal(workspaceId);
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
  }, [workspaceId, runCommand]);

  if (!runCommand) {
    return null;
  }

  return (
    <Button
      disabled={runBusy}
      leading={<Icons.PlayIcon size={10} />}
      size="sm"
      variant="primary"
      title={runBusy ? "Running..." : (runCommand ?? undefined)}
      onClick={handleRun}
    >
      Run
    </Button>
  );
}
