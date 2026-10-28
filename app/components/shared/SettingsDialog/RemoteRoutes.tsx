import type { RemoteConfigPatch, RemoteStatus } from "../../../lib/types";
import { Button, SettingsScreenField, StatusDot } from "@argus/peacock";
import { accountSetConfig } from "../../../lib/ipc";
import {
  legacyTunnelLabel,
  legacyTunnelTone,
  managedTunnelLabel,
  managedTunnelNote,
  managedTunnelTone,
} from "../../../lib/remoteRoutes";
import { showSettingsDialog } from "../../../stores/settingsStore";
import styles from "./RemoteAccessSection.module.css";

interface RemoteRoutesProps {
  busy: boolean;
  onApply: (patch: RemoteConfigPatch) => void;
  status: RemoteStatus;
}

function ManagedTunnelRow({ status }: { status: RemoteStatus }) {
  const tunnel = status.managedTunnel;
  const note = managedTunnelNote(tunnel);

  return (
    <div className={styles.route}>
      <div className={styles.routeHead}>
        <span className={styles.routeName}>Managed tunnel</span>
        <StatusDot
          tone={managedTunnelTone(tunnel)}
          label={managedTunnelLabel(tunnel)}
        />
      </div>
      {tunnel.phase === "running" && tunnel.url && (
        <code className={styles.routeUrl}>{tunnel.url}</code>
      )}
      {note && (
        <p
          className={
            tunnel.phase === "error" ? styles.tunnelError : styles.routeNote
          }
        >
          {note}
        </p>
      )}
      {tunnel.phase === "off" && tunnel.reason === "not_linked" && (
        <div>
          <Button
            variant="secondary"
            onClick={() => showSettingsDialog("account")}
          >
            Link in Account settings
          </Button>
        </div>
      )}
      {tunnel.phase === "off" && tunnel.reason === "turned_off" && (
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              accountSetConfig({ tunnel: true }).catch(() => undefined)
            }
          >
            Turn it on
          </Button>
        </div>
      )}
    </div>
  );
}

function LegacyTunnels({ busy, onApply, status }: RemoteRoutesProps) {
  return (
    <SettingsScreenField
      label="Older tunnels"
      caption="Set up by an earlier version of Argus. They keep running until the managed tunnel takes over, then stop on their own."
    >
      <div className={styles.routeList}>
        {status.legacyTunnels.map((t) => (
          <div key={t.kind} className={styles.route}>
            <div className={styles.routeHead}>
              <span className={styles.routeName}>
                {legacyTunnelLabel(t.kind)}
              </span>
              <StatusDot tone={legacyTunnelTone(t)} label={t.status} />
            </div>
            {t.publicUrl && (
              <code className={styles.routeUrl}>{t.publicUrl}</code>
            )}
            {t.error && <p className={styles.tunnelError}>{t.error}</p>}
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onApply({ retireLegacyTunnels: true })}
          >
            {status.legacyTunnels.length === 1
              ? "Stop using it"
              : "Stop using them"}
          </Button>
        </div>
      </div>
    </SettingsScreenField>
  );
}

/** How a device reaches this computer: LAN, then Tailscale, then the tunnel. */
export function RemoteRoutes(props: RemoteRoutesProps) {
  const { status } = props;

  return (
    <>
      <SettingsScreenField
        label="Routes"
        caption="A paired device gets every route and uses the closest one that works: this network first, then Tailscale, then the managed tunnel. Traffic is end-to-end encrypted on each."
      >
        <div className={styles.routeList}>
          <div className={styles.route}>
            <span className={styles.routeName}>Local network</span>
            {status.lanUrl ? (
              <code className={styles.routeUrl}>{status.lanUrl}</code>
            ) : (
              <p className={styles.routeNote}>No local address.</p>
            )}
          </div>
          <div className={styles.route}>
            <span className={styles.routeName}>Tailscale</span>
            {status.tailscaleUrl ? (
              <code className={styles.routeUrl}>{status.tailscaleUrl}</code>
            ) : (
              <p className={styles.routeNote}>
                Run Tailscale on this computer and your phone for a direct route
                when you&apos;re away.
              </p>
            )}
          </div>
          <ManagedTunnelRow status={status} />
        </div>
      </SettingsScreenField>
      {status.legacyTunnels.length > 0 && <LegacyTunnels {...props} />}
    </>
  );
}
