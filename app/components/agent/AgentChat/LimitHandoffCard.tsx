import type { LimitHandoffAccount } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { LimitHandoffCard as Card } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { getAgentLimitHandoff, handoffAgentToAccount } from "../../../lib/ipc";
import styles from "./AgentChat.module.css";

/** Offers the user's other Claude accounts while a turn is stuck on a spent limit. */
export function LimitHandoffCard({ agentId }: { agentId: string }) {
  const [accounts, setAccounts] = useState<LimitHandoffAccount[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    getAgentLimitHandoff(agentId)
      .then((rows) => live && setAccounts(rows))
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [agentId]);

  useEffect(load, [load]);

  useIpcEvent<boolean>(`agent:limit-stall:${agentId}`, (stalled) => {
    setError(null);
    if (stalled) {
      load();
    } else {
      setAccounts([]);
      setPendingId(null);
    }
  });

  return (
    <Card
      accounts={accounts}
      className={styles.limitResumeBanner}
      error={error}
      pendingId={pendingId}
      onHandoff={(accountId) => {
        setPendingId(accountId);
        setError(null);
        handoffAgentToAccount(agentId, accountId)
          .then(() => setAccounts([]))
          .catch((e: unknown) => setError(String(e)))
          .finally(() => setPendingId(null));
      }}
    />
  );
}
