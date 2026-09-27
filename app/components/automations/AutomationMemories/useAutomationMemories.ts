import type { AutomationMemory } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { listAutomationMemories } from "../../../lib/ipc";
import { useRouteHostId } from "../../../lib/routeHooks";

/** An automation's memories, refetched whenever a run or the user changes them. */
export function useAutomationMemories(automationId: string): {
  error: string | null;
  memories: AutomationMemory[] | null;
} {
  const hostId = useRouteHostId();
  const [memories, setMemories] = useState<AutomationMemory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAutomationMemories(automationId)
      .then((result) => {
        setMemories(result.memories);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(typeof e === "string" ? e : String(e));
      });
  }, [automationId]);

  useEffect(load, [load, hostId]);

  useIpcEvent<{ automation_id: string }>(
    "automation_memory:changed",
    (payload) => {
      if (payload.automation_id === automationId) {
        load();
      }
    },
    hostId,
  );

  return { error, memories };
}
