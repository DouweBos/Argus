/**
 * The composer's `/usage-limits`: the agent's runner's plan limits from the
 * usage store, in a panel above the composer. Never sent to the agent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { agentLimitsView, runnerHasLimits } from "@argus/client-core";
import { AgentLimitsPanel } from "@argus/peacock";
import type { RemoteSlashCommand } from "../lib/protocol";
import { appNavigate } from "../routing/router";
import { useAgentsStore } from "../stores/agents";
import { useUsageStore } from "../stores/usage";

export const USAGE_LIMITS_COMMAND: RemoteSlashCommand = {
  name: "usage-limits",
  description: "Show this agent's plan limits here, without sending anything",
  argumentHint: "",
};

export function useUsageLimitsCommand(agentId: string) {
  const runnerId = useAgentsStore((s) => s.statusByAgent[agentId]?.runner_id);
  const limits = useUsageStore((s) => s.limits);
  const loadLimits = useUsageStore((s) => s.loadLimits);
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [agentId]);

  const show = useCallback(() => {
    setOpen(true);
    // The last snapshot is enough; only an empty store asks the host.
    if (!useUsageStore.getState().limits) {
      loadLimits().catch(() => {});
    }
  }, [loadLimits]);
  const close = useCallback(() => setOpen(false), []);

  const offered = runnerHasLimits(limits, runnerId);

  return useMemo(
    () => ({
      command: offered ? USAGE_LIMITS_COMMAND : null,
      open,
      show,
      close,
    }),
    [offered, open, show, close],
  );
}

export function AgentLimits({
  agentId,
  onDismiss,
}: {
  agentId: string;
  onDismiss: () => void;
}) {
  const runnerId = useAgentsStore((s) => s.statusByAgent[agentId]?.runner_id);
  const limits = useUsageStore((s) => s.limits);
  const limitsAt = useUsageStore((s) => s.limitsAt);
  const load = useUsageStore((s) => s.limitsLoad);
  const view = useMemo(
    () => (limits ? agentLimitsView(limits, runnerId, limitsAt) : null),
    [limits, runnerId, limitsAt],
  );

  return (
    <AgentLimitsPanel
      accounts={view?.accounts ?? []}
      error={load.error}
      loading={!limits && !load.error}
      pools={view?.pools ?? null}
      title={view?.title ?? "This agent"}
      onDismiss={onDismiss}
      onOpenUsage={() =>
        appNavigate({ name: "usage", tab: "limits", range: "30d" })
      }
    />
  );
}
