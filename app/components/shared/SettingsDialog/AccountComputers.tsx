import type { AccountHost, AccountJoinRequest } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { Button, SettingsScreenField, StatusBulb } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { refreshAccountHosts } from "../../../lib/accountHosts";
import {
  accountApproveJoin,
  accountDenyJoin,
  accountListRequests,
} from "../../../lib/ipc";
import styles from "./AccountSection.module.css";

function lastSeen(host: AccountHost): string {
  if (host.online) {
    return "Online";
  }
  if (host.last_seen === null) {
    return "Offline";
  }

  return `Offline · last seen ${new Date(host.last_seen).toLocaleString()}`;
}

/** Also folds the computers into Hosts, so they attach like a pairing. */
async function load(): Promise<{
  hosts: AccountHost[];
  requests: AccountJoinRequest[];
}> {
  const hosts = await refreshAccountHosts();
  const requests = await accountListRequests().catch(() => []);

  return { hosts, requests };
}

/** The account's computers, and other computers waiting to join it. */
export function AccountComputers() {
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
              <span className={styles.muted}>{lastSeen(host)}</span>
            </div>
          ))}
        </div>
      </SettingsScreenField>
      {requests.length > 0 && (
        <SettingsScreenField
          label="Waiting to join"
          caption="Approve only a computer you just started linking. You'll compare a code on both screens."
        >
          <div className={styles.list}>
            {requests.map((r) => (
              <div key={r.request_id} className={styles.row}>
                <span className={styles.name}>{r.subject_name}</span>
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
