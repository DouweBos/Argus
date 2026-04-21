import { useMemo } from "react";
import {
  useAllRunningTerminals,
  useLiveSessions,
} from "../../stores/terminalStore";

export interface RunningRuntime {
  alive: boolean;
  sessionId: string;
  terminalId: string;
  title: string;
}

/**
 * Flatten the per-session `runningTerminals` map into a list of runtime
 * processes across every session/project in the current renderer.
 */
export function useRunningRuntimes(): RunningRuntime[] {
  const runningTerminals = useAllRunningTerminals();
  const liveSessions = useLiveSessions();

  return useMemo(() => {
    const out: RunningRuntime[] = [];
    for (const [sessionId, titles] of Object.entries(runningTerminals)) {
      for (const [title, terminalId] of Object.entries(titles)) {
        out.push({
          sessionId,
          terminalId,
          title,
          alive: liveSessions[terminalId] ?? false,
        });
      }
    }

    return out;
  }, [runningTerminals, liveSessions]);
}
