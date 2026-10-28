import type {
  AccountHost,
  AccountJoinRequest,
  AccountStatus,
} from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { Button, SettingsScreenField, StatusBulb } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { useLiveRefresh } from "../../../hooks/useLiveRefresh";
import { refreshAccountHosts } from "../../../lib/accountHosts";
import { memberKindLabel } from "../../../lib/accountMembers";
import { presenceLabel } from "../../../lib/accountPresence";
import {
  accountApproveJoin,
  accountDenyJoin,
  accountListRequests,
} from "../../../lib/ipc";
import { PRESENCE_POLL_MS } from "../../../stores/accountPresenceStore";
import { AccountMemberActions } from "./AccountMemberActions";
import styles from "./AccountSection.module.css";

/** Also folds the computers into Hosts, so they attach like a pairing. */
async function load(): Promise<{
  hosts: AccountHost[];
  requests: AccountJoinRequest[];
}> {
  const hosts = await refreshAccountHosts();
  const requests = await accountListRequests().catch(() => []);

  return { hosts, requests };
}

/** The account's computers, and computers and devices waiting to join it. */
export function AccountComputers({ status }: { status: AccountStatus }) {
  const [hosts, setHosts] = useState<AccountHost[]>([]);
  const [requests, setRequests] = useState<AccountJoinRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      load().then(
        (loaded) => {
          setHosts(loaded.hosts);
          setRequests(loaded.requests);
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [],
  );

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);
  useIpcEvent("account:status", () => {
    refresh().catch(() => undefined);
  });
  useLiveRefresh(() => {
    refresh().catch(() => undefined);
  }, PRESENCE_POLL_MS);

  const act = (action: () => Promise<unknown>) => {
    setError(null);
    action()
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => refresh().catch(() => undefined));
  };

  return (
    <>
      <SettingsScreenField
        label="Computers"
        caption="Every computer on the account appears under Hosts, where you can attach to it — no pairing code needed."
      >
        <div className={styles.list}>
          {hosts.map((host) => (
            <div key={host.host_id} className={styles.row}>
              <StatusBulb tone={host.online ? "success" : "neutral"} />
              <span className={styles.name}>
                {host.name}
                {host.is_self ? " (this computer)" : ""}
              </span>
              <span className={styles.muted}>{presenceLabel(host)}</span>
              <AccountMemberActions
                id={host.host_id}
                name={host.name}
                canRename={host.is_self || status.device_id !== null}
                canRemove={!host.is_self && status.device_id !== null}
                onChanged={() => {
                  refresh().catch(() => undefined);
                }}
                onError={setError}
              />
            </div>
          ))}
        </div>
      </SettingsScreenField>
      {requests.length > 0 && (
        <SettingsScreenField
          label="Waiting to join"
          caption="Approve only a computer or device you just started adding. You'll compare a code on both screens."
        >
          <div className={styles.list}>
            {requests.map((r) => (
              <div key={r.request_id} className={styles.row}>
                <span className={styles.name}>{r.subject_name}</span>
                <span className={styles.muted}>
                  {memberKindLabel(r.subject_kind)}
                </span>
                <div className={styles.actions}>
                  <Button
                    variant="ghost"
                    onClick={() => act(() => accountDenyJoin(r.request_id))}
                  >
                    Deny
                  </Button>
                  <Button
                    onClick={() => act(() => accountApproveJoin(r.request_id))}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SettingsScreenField>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
