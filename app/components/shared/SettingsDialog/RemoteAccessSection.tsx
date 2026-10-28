import type { RemoteConfigPatch, RemoteStatus } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Input,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  StatusDot,
  Toggle,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  remoteGetStatus,
  remoteRevokeDevice,
  remoteSetConfig,
  remoteSetDeviceGrants,
} from "../../../lib/ipc";
import { reachabilityLabel, reachabilityTone } from "../../../lib/remoteRoutes";
import {
  setHuddleDisplayName,
  useHuddleDisplayName,
} from "../../../stores/settingsStore";
import styles from "./RemoteAccessSection.module.css";
import { RemoteDeviceRow } from "./RemoteDeviceRow";
import { RemotePairingField } from "./RemotePairingField";
import { RemotePushFields } from "./RemotePushFields";
import { RemoteRoutes } from "./RemoteRoutes";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function RemoteAccessSection() {
  const huddleDisplayName = useHuddleDisplayName();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await remoteGetStatus());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live route updates (e.g. the managed tunnel finishing startup).
  useIpcEvent<RemoteStatus>("remote:status", (s) => setStatus(s));

  const run = async (action: () => Promise<RemoteStatus | undefined>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) {
        setStatus(next);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const applyConfig = (patch: RemoteConfigPatch) =>
    run(() => remoteSetConfig(patch));

  const setGrants = (
    id: string,
    grants: { admin: boolean; control: boolean },
  ) =>
    run(async () => {
      await remoteSetDeviceGrants(id, grants);
      await refresh();

      return undefined;
    });

  const revoke = (id: string) => run(() => remoteRevokeDevice(id));

  const enabled = status?.enabled ?? false;
  // Any address will do for the QR; the phone learns the rest after pairing.
  const canPair = enabled && Boolean(status?.publicUrl);

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Pair a phone to monitor your projects and agents from anywhere. Argus runs a local, end-to-end-encrypted gateway with no inbound ports: devices reach it on this network, over Tailscale, or through the managed tunnel your Argus account provides. Paired devices monitor and approve prompts by default; grant a device control to also let it drive agents. Creating projects always stays on this machine."
        title="Remote access"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Enable remote access"
          caption="Starts the local gateway and, on a linked computer, the managed tunnel."
        >
          <div className={styles.toggleRow}>
            <Toggle
              checked={enabled}
              disabled={busy}
              onChange={(next) => applyConfig({ enabled: next })}
            />
            {status && (
              <StatusDot
                tone={enabled ? reachabilityTone(status) : "idle"}
                label={enabled ? reachabilityLabel(status) : "off"}
              />
            )}
          </div>
        </SettingsScreenField>

        {status && (
          <RemoteRoutes busy={busy} onApply={applyConfig} status={status} />
        )}

        {enabled && status && (
          <SettingsScreenField
            label="Web client on this network"
            caption="Argus serves the web client to other devices on your Wi-Fi. Open this in a browser and pair it like any other device."
          >
            <span className={styles.deviceMeta}>
              {status.lanUrl
                ? status.lanUrl.replace(/^ws:/, "http:")
                : "no LAN address"}
            </span>
          </SettingsScreenField>
        )}

        <RemotePushFields disabled={busy || !enabled} />

        <SettingsScreenField
          label="Notify my devices while I'm using Argus"
          caption="Off by default: your phone and browsers stay quiet whenever the Argus window is focused, so they only interrupt you when you've stepped away."
        >
          <div className={styles.toggleRow}>
            <Toggle
              checked={status?.notifyWhenFocused ?? false}
              disabled={busy || !enabled}
              onChange={(next) => applyConfig({ notifyWhenFocused: next })}
            />
          </div>
        </SettingsScreenField>

        <RemotePairingField
          canPair={canPair}
          onError={setError}
          onPaired={refresh}
        />

        {status && status.devices.length > 0 && (
          <SettingsScreenField label="Paired devices">
            <div className={styles.deviceList}>
              {status.devices.map((d) => (
                <RemoteDeviceRow
                  key={d.device_id}
                  device={d}
                  connected={status.connectedDeviceIds.includes(d.device_id)}
                  busy={busy}
                  onRevoke={revoke}
                  onSetGrants={setGrants}
                />
              ))}
            </div>
          </SettingsScreenField>
        )}

        <SettingsScreenField
          label="Your name on a huddle invite"
          caption="Used in “… wants you to join”. Empty uses the name you commit under."
        >
          <Input
            placeholder="Your name"
            value={huddleDisplayName}
            onChange={(e) => setHuddleDisplayName(e.target.value)}
          />
        </SettingsScreenField>

        {error && <p className={styles.error}>{error}</p>}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
