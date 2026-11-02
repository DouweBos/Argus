/**
 * A chat stalled on a spent usage limit: the computer's other Claude accounts
 * it could continue on. Shown while the status says it's stalled.
 */

import { useEffect, useState } from "react";
import { describeError } from "@argus/client-core";
import { LimitHandoffCard } from "@argus/peacock";
import { useAgentExtrasStore } from "../../stores/agentExtras";
import { useConnectionStore } from "../../stores/connection";

const NO_ACCOUNTS: never[] = [];

export function LimitHandoff({ agentId }: { agentId: string }) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const accounts = useAgentExtrasStore(
    (s) => s.handoffByAgent[agentId] ?? NO_ACCOUNTS,
  );
  const loadHandoff = useAgentExtrasStore((s) => s.loadHandoff);
  const handoff = useAgentExtrasStore((s) => s.handoff);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection === "ready") {
      void loadHandoff(agentId);
    }
  }, [agentId, connection, loadHandoff]);

  return (
    <LimitHandoffCard
      accounts={accounts}
      error={error}
      pendingId={pendingId}
      onHandoff={
        hasControl
          ? (accountId) => {
              setPendingId(accountId);
              setError(null);
              handoff(agentId, accountId)
                .catch((err: unknown) => setError(describeError(err)))
                .finally(() => setPendingId(null));
            }
          : undefined
      }
    />
  );
}
