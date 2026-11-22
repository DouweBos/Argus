/**
 * The composer's ⋮ menu. Account is only offered with more than one; the
 * computer captures the switch itself as `agent_account_switched`.
 */

import { useEffect, useMemo } from "react";
import {
  accountPickerLabel,
  accountPickerOptions,
  FOLLOW_DEFAULT_ACCOUNT,
  offersAccountPicker,
} from "@argus/client-core";
import { Icons, OverflowMenu } from "@argus/peacock";
import { useClaudeAccountsStore } from "../stores/claudeAccounts";
import { useConnectionStore } from "../stores/connection";
import { useProjectsStore } from "../stores/projects";
import { capture } from "../telemetry/telemetry";

export function ComposerOverflowMenu({
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
  const account = accountPickerLabel(accounts, pinned);

  return (
    <OverflowMenu
      title={`More options, account: ${account}`}
      items={[
        {
          label: "Account",
          description: account,
          icon: <Icons.OrganizationIcon size={12} />,
          children: options.map(({ value, name, description }) => ({
            label: name,
            description,
            title: description,
            selected: value === (pinned ?? FOLLOW_DEFAULT_ACCOUNT),
            onClick: () => {
              setAgentAccount(
                agentId,
                sessionId,
                value === FOLLOW_DEFAULT_ACCOUNT ? null : value,
              ).catch(() => {});
            },
          })),
        },
      ]}
      onOpen={() => capture("web_composer_overflow_opened")}
    />
  );
}
