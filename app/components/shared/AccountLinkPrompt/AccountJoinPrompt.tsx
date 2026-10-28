import type { AccountJoinRequest } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@argus/peacock";
import { useAccountStatus } from "../../../hooks/useAccountStatus";
import { useLiveRefresh } from "../../../hooks/useLiveRefresh";
import { accountApproveJoin, accountListRequests } from "../../../lib/ipc";
import styles from "./AccountLinkPrompt.module.css";

/** A request lives 10 minutes; checking every 30 s while visible catches it. */
const POLL_MS = 30_000;

function what(request: AccountJoinRequest): string {
  if (request.subject_role === "host") {
    return "A computer";
  }

  if (request.subject_kind === "ios") {
    return "An iPhone";
  }

  return request.subject_kind === "web" ? "A browser" : "A device";
}

/**
 * Someone signed in on a new device (or started linking a computer) and is
 * waiting for this one to approve: say so wherever the window is, instead of
 * only in Settings. Approving opens the code comparison.
 */
export function AccountJoinPrompt() {
  const { status } = useAccountStatus();
  const watching = !!status?.linked && !!status.config.hosts_can_approve;
  const [requests, setRequests] = useState<AccountJoinRequest[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(() => {
    if (!watching) {
      return;
    }
    accountListRequests()
      .then(setRequests)
      .catch(() => undefined);
  }, [watching]);
  useEffect(refresh, [refresh]);
  useLiveRefresh(refresh, POLL_MS);

  const next = (watching ? requests : []).find(
    (r) => r.status === "claimed" && !dismissed.has(r.request_id),
  );
  if (!next) {
    return null;
  }
  const dismiss = () => setDismissed((d) => new Set([...d, next.request_id]));

  return (
    <ConfirmDialog
      title={`${next.subject_name} wants to join your account`}
      titleId="account-join-title"
      confirmLabel="Review"
      cancelLabel="Not now"
      onCancel={dismiss}
      onConfirm={async () => {
        dismiss();
        await accountApproveJoin(next.request_id);
      }}
    >
      <p className={styles.lead}>
        {what(next)} is asking to be added. You&apos;ll compare a 6-digit code
        on both screens before anything changes.
      </p>
      <p className={styles.lead}>
        Didn&apos;t just sign in on it? Choose Not now and deny it in Settings →
        Account.
      </p>
    </ConfirmDialog>
  );
}
