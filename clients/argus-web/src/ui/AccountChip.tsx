/**
 * Which Claude account an agent's session runs as, from the composer. Only
 * offered with more than one account; the computer moves the agent once any
 * running turn ends and captures `agent_account_switched` itself.
 */

import { useEffect, useMemo } from "react";
import {
  accountPickerLabel,
  accountPickerOptions,
  FOLLOW_DEFAULT_ACCOUNT,
  offersAccountPicker,
} from "@argus/client-core";
import { Icons, PickerChip } from "@argus/peacock";
import { useClaudeAccountsStore } from "../stores/claudeAccounts";
import { useConnectionStore } from "../stores/connection";
import { useProjectsStore } from "../stores/projects";

export function AccountChip({
  agentId,
  sessionId,
}: {
  agentId: string;
  sessionId: string | undefined;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const accounts = useClaudeAccountsStore((s) => s.accounts);
  const activeId = useClaudeAccountsStore((s) => s.activeId);
  const refresh = useClaudeAccountsStore((s) => s.refresh);
  const setAgentAccount = useClaudeAccountsStore((s) => s.setAgentAccount);
  const pinned = useProjectsStore((s) => {
    if (!sessionId) {
      return null;
    }
    for (const sessions of Object.values(s.sessionsByRepo)) {
      const session = sessions.find((x) => x.id === sessionId);
      if (session) {
        return session.claude_account_id ?? null;
      }
    }

    return null;
  });

  useEffect(() => {
    if (ready && accounts === null) {
      refresh({ background: true }).catch(() => {});
    }
  }, [ready, accounts, refresh]);

  const options = useMemo(
    () => accountPickerOptions(accounts ?? [], activeId),
    [accounts, activeId],
  );
  if (!sessionId || !accounts || !offersAccountPicker(accounts)) {
    return null;
  }

  return (
    <PickerChip
      header="Run this session as"
      leading={<Icons.OrganizationIcon size={11} />}
      label={accountPickerLabel(accounts, pinned)}
      muted={!pinned}
      options={options}
      selected={[pinned ?? FOLLOW_DEFAULT_ACCOUNT]}
      title="Claude account"
      onSelect={(value) => {
        setAgentAccount(
          agentId,
          sessionId,
          value === FOLLOW_DEFAULT_ACCOUNT ? null : value,
        ).catch(() => {});
      }}
    />
  );
}
