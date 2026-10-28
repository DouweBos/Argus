import type {
  AccountApprovalState,
  AccountLinkState,
} from "../../../lib/types";
import { useState } from "react";
import { ConfirmDialog } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { accountConfirmJoin, accountLoginConfirm } from "../../../lib/ipc";
import { AccountJoinPrompt } from "./AccountJoinPrompt";
import styles from "./AccountLinkPrompt.module.css";

function spaced(sas: string): string {
  return `${sas.slice(0, 3)} ${sas.slice(3)}`;
}

/**
 * The console prompts of the account flow, wherever the window is: confirm
 * the code when linking this computer, or when approving another computer or
 * device — and the nudge when one is waiting to join.
 * A paired phone can start a link (`account.request_link`), so this can't
 * live inside Settings.
 */
export function AccountLinkPrompt() {
  const [link, setLink] = useState<AccountLinkState>({ kind: "idle" });
  const [approval, setApproval] = useState<AccountApprovalState>({
    kind: "idle",
  });
  useIpcEvent<AccountLinkState>("account:link-state", setLink);
  useIpcEvent<AccountApprovalState>("account:approval-state", setApproval);

  if (link.kind === "awaiting_first") {
    return (
      <ConfirmDialog
        title="Make this the first computer on your account?"
        titleId="account-first-title"
        confirmLabel="Make it the first"
        onCancel={() => accountLoginConfirm(false).catch(() => undefined)}
        onConfirm={async () => {
          await accountLoginConfirm(true);
        }}
      >
        Your account has no devices or computers yet. This computer becomes its
        first member; sign in on your phone afterwards to reach it.
      </ConfirmDialog>
    );
  }
  if (link.kind === "awaiting_sas") {
    return (
      <ConfirmDialog
        title="Do the codes match?"
        titleId="account-sas-title"
        confirmLabel="Codes match"
        cancelLabel="They don't"
        onCancel={() => accountLoginConfirm(false).catch(() => undefined)}
        onConfirm={async () => {
          await accountLoginConfirm(true);
        }}
      >
        <p className={styles.lead}>
          {link.approver_name} is adding this computer to your account. It
          shows:
        </p>
        <p className={styles.code}>{spaced(link.sas)}</p>
        <p className={styles.lead}>
          Only confirm if it&apos;s exactly the same number.
        </p>
      </ConfirmDialog>
    );
  }
  if (approval.kind === "awaiting_sas") {
    return (
      <ConfirmDialog
        title="Do the codes match?"
        titleId="account-approve-title"
        confirmLabel="Codes match — add it"
        cancelLabel="They don't"
        onCancel={() => accountConfirmJoin(false).catch(() => undefined)}
        onConfirm={async () => {
          await accountConfirmJoin(true);
        }}
      >
        <p className={styles.lead}>
          You&apos;re adding {approval.subject_name} to your account. It shows:
        </p>
        <p className={styles.code}>{spaced(approval.sas)}</p>
      </ConfirmDialog>
    );
  }

  return <AccountJoinPrompt />;
}
