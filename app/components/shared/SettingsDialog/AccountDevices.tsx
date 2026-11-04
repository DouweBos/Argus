import type { AccountMemberInfo, AccountStatus } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { AccountMemberActions, SettingsScreenField } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { memberKindLabel } from "../../../lib/accountMembers";
import {
  accountListMembers,
  accountRenameMember,
  accountRevokeMember,
} from "../../../lib/ipc";
import styles from "./AccountSection.module.css";

function added(member: AccountMemberInfo): string {
  return `added ${new Date(member.created_at).toLocaleDateString()}`;
}

/** The phones, Macs and desktop windows on the account. */
export function AccountDevices({ status }: { status: AccountStatus }) {
  const [devices, setDevices] = useState<AccountMemberInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    accountListMembers()
      .then((members) => setDevices(members.filter((m) => m.role === "device")))
      .catch(() => undefined);
  }, []);

  useEffect(refresh, [refresh]);
  useIpcEvent("account:status", refresh);

  // Only this window's device may sign changes to other members.
  const canManage = status.device_id !== null;

  return (
    <SettingsScreenField
      label="Devices"
      caption={
        canManage
          ? "Removing a device disconnects it from every computer on the account."
          : "Remove devices from your phone or the Mac app; this computer can only change itself."
      }
    >
      <div className={styles.list}>
        {devices.map((device) => (
          <div key={device.id} className={styles.row}>
            <span className={styles.name}>
              {device.name}
              {device.is_self ? " (this window)" : ""}
            </span>
            <span className={styles.muted}>
              {memberKindLabel(device.kind)} · {added(device)}
            </span>
            <AccountMemberActions
              onRename={(name) => accountRenameMember(device.id, name)}
              onRemove={() => accountRevokeMember(device.id)}
              name={device.name}
              canRename={canManage}
              canRemove={canManage && !device.is_self}
              onChanged={() => {
                setError(null);
                refresh();
              }}
              onError={setError}
            />
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </SettingsScreenField>
  );
}
