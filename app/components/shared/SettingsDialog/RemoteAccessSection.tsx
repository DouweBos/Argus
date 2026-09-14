import type {
  RemoteEndpointKind,
  RemoteDevice,
  RemoteStatus,
  RemoteTunnelMode,
} from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Icons,
  Input,
  QrCode,
  SegmentedControl,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  StatusDot,
  Toggle,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  remoteCancelPairing,
  remoteConfirmPairing,
  remoteGetStatus,
  remoteRevokeDevice,
  remoteSetConfig,
  remoteSetDeviceControl,
  remoteStartPairing,
} from "../../../lib/ipc";
import styles from "./RemoteAccessSection.module.css";
import { RemoteDeviceRow } from "./RemoteDeviceRow";
import { RemotePushFields } from "./RemotePushFields";
import { TailscaleSetup } from "./TailscaleSetup";

type PairPhase = "awaiting-sas" | "idle" | "starting" | "waiting-device";

const MODE_OPTIONS = [
  { value: "quick" as const, label: "Quick tunnel" },
  { value: "token" as const, label: "Named tunnel" },
];

/** Monospace code with a copy button that reveals on hover, like chat. */
function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  return (
    <div className={styles.codeRow}>
      <code className={styles.code}>{value}</code>
      <button
        type="button"
        className={styles.copyBtn}
        onClick={copy}
        aria-label="Copy pairing code"
      >
        {copied ? <Icons.CheckIcon size={13} /> : <Icons.CopyIcon size={13} />}
      </button>
    </div>
  );
}

const ENDPOINT_LABELS: Record<RemoteEndpointKind, string> = {
  lan: "Local network",
  tailscale: "Tailscale",
  cloudflare: "Cloudflare",
};

function tunnelTone(status: string): "error" | "idle" | "success" {
  if (status === "running") {
    return "success";
  }

  return status === "error" ? "error" : "idle";
}

/** Green once any address is live, red only when every enabled way in failed. */
function reachabilityTone(status: RemoteStatus): "error" | "idle" | "success" {
  if (status.endpoints.length > 0) {
    return "success";
  }
  const failed = Object.values(status.tunnels).some(
    (t) => t.status === "error",
  );

  return failed ? "error" : "idle";
}

function reachabilityLabel(status: RemoteStatus): string {
  const count = status.endpoints.length;
  if (count > 0) {
    return count === 1 ? "1 way in" : `${count} ways in`;
  }

  return reachabilityTone(status) === "error" ? "unreachable" : "starting";
}

export function RemoteAccessSection() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [token, setToken] = useState("");
  const [publicUrl, setPublicUrl] = useState("");

  const [phase, setPhase] = useState<PairPhase>("idle");
  const [qr, setQr] = useState<{
    pairingCode: string;
    qrPayload: string;
  } | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [grantControl, setGrantControl] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await remoteGetStatus();
      setStatus(s);
      if (s.tunnelMode === "token" && s.publicUrl) {
        setPublicUrl((prev) => prev || s.publicUrl!);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live tunnel updates (e.g. a quick tunnel finishing startup).
  useIpcEvent<RemoteStatus>("remote:status", (s) => setStatus(s));

  const resetPairing = useCallback(() => {
    setPhase("idle");
    setQr(null);
    setSas(null);
    setGrantControl(false);
  }, []);

  useIpcEvent<{ sas: string }>("remote:pairing-sas", (p) => {
    setSas(p.sas);
    setPhase("awaiting-sas");
  });
  useIpcEvent<{ device: RemoteDevice }>("remote:pairing-complete", () => {
    resetPairing();
    refresh();
  });
  useIpcEvent<{ message: string }>("remote:pairing-error", (p) => {
    setError(p.message);
    resetPairing();
  });

  const applyConfig = async (cfg: {
    cloudflareEnabled?: boolean;
    enabled?: boolean;
    lanWeb?: boolean;
    notifyWhenFocused?: boolean;
    publicUrl?: string;
    tailscaleEnabled?: boolean;
    tunnelMode?: RemoteTunnelMode;
    tunnelToken?: string;
  }) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await remoteSetConfig(cfg));
      if (cfg.tunnelToken !== undefined) {
        setToken("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startPairing = async () => {
    setError(null);
    setPhase("starting");
    try {
      const start = await remoteStartPairing();
      setQr({ qrPayload: start.qrPayload, pairingCode: start.pairingCode });
      setPhase("waiting-device");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      resetPairing();
    }
  };

  const confirmPairing = async () => {
    setError(null);
    try {
      await remoteConfirmPairing(grantControl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setControl = async (id: string, control: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await remoteSetDeviceControl(id, control);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelPairing = () => {
    remoteCancelPairing().catch(() => {});
    resetPairing();
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      setStatus(await remoteRevokeDevice(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = status?.enabled ?? false;
  const tailscaleOn = status?.tailscaleEnabled ?? false;
  const cloudflareOn = status?.cloudflareEnabled ?? false;
  const mode = status?.tunnelMode ?? "quick";
  const canPair = enabled && Boolean(status?.publicUrl);

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Pair a phone to monitor your projects and agents from anywhere. Argus exposes a local, end-to-end-encrypted gateway through a Cloudflare or Tailscale tunnel — no inbound ports. Paired devices monitor and approve prompts by default; grant a device control to also let it drive agents. Creating projects always stays on this machine."
        title="Remote access"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Enable remote access"
          caption="Starts the local gateway and every enabled tunnel below."
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

        <SettingsScreenField
          label="Ways in"
          caption="Enable as many as you like — they run side by side. A paired phone syncs every address and connects over the simplest one that works: Wi-Fi first, then Tailscale, then Cloudflare."
        >
          <div className={styles.providerList}>
            <div className={styles.providerRow}>
              <Toggle
                checked={status?.lanWebEnabled ?? false}
                disabled={busy}
                onChange={(next) => applyConfig({ lanWeb: next })}
              />
              <span className={styles.providerName}>Local network</span>
              <StatusDot
                tone={status?.lanUrl ? "success" : "idle"}
                label={status?.lanUrl ?? "off"}
              />
            </div>
            <div className={styles.providerRow}>
              <Toggle
                checked={tailscaleOn}
                disabled={busy}
                onChange={(next) => applyConfig({ tailscaleEnabled: next })}
              />
              <span className={styles.providerName}>Tailscale</span>
              {status && (
                <StatusDot
                  tone={
                    tailscaleOn
                      ? tunnelTone(status.tunnels.tailscale.status)
                      : "idle"
                  }
                  label={
                    tailscaleOn
                      ? (status.tunnels.tailscale.publicUrl ??
                        status.tunnels.tailscale.status)
                      : "off"
                  }
                />
              )}
            </div>
            {tailscaleOn && status?.tunnels.tailscale.error && (
              <p className={styles.tunnelError}>
                {status.tunnels.tailscale.error}
              </p>
            )}
            <div className={styles.providerRow}>
              <Toggle
                checked={cloudflareOn}
                disabled={busy}
                onChange={(next) => applyConfig({ cloudflareEnabled: next })}
              />
              <span className={styles.providerName}>Cloudflare</span>
              {status && (
                <StatusDot
                  tone={
                    cloudflareOn
                      ? tunnelTone(status.tunnels.cloudflare.status)
                      : "idle"
                  }
                  label={
                    cloudflareOn
                      ? (status.tunnels.cloudflare.publicUrl ??
                        status.tunnels.cloudflare.status)
                      : "off"
                  }
                />
              )}
            </div>
            {cloudflareOn && status?.tunnels.cloudflare.error && (
              <p className={styles.tunnelError}>
                {status.tunnels.cloudflare.error}
              </p>
            )}
          </div>
        </SettingsScreenField>

        {tailscaleOn && (
          <SettingsScreenField
            label="Tailscale Funnel"
            caption="Exposes the gateway at your stable `*.ts.net` address — no domain or Cloudflare account. Argus checks each prerequisite below and can fix them for you."
          >
            <TailscaleSetup />
          </SettingsScreenField>
        )}

        {cloudflareOn && (
          <SettingsScreenField
            label="Tunnel"
            caption="Quick = ephemeral trycloudflare.com URL (no account). Named = stable hostname via a Cloudflare connector token; survives restarts so devices stay paired."
          >
            <SegmentedControl<RemoteTunnelMode>
              aria-label="Tunnel mode"
              value={mode}
              options={MODE_OPTIONS}
              onChange={(m) => applyConfig({ tunnelMode: m })}
            />
          </SettingsScreenField>
        )}

        {cloudflareOn && mode === "token" && (
          <>
            <SettingsScreenField
              label="Connector token"
              caption={
                status?.hasTunnelToken
                  ? "A token is set. Enter a new one to replace it."
                  : "From `cloudflared tunnel token <name>` or the Cloudflare dashboard."
              }
            >
              <div className={styles.inlineForm}>
                <Input
                  type="password"
                  placeholder={
                    status?.hasTunnelToken ? "••••••••" : "Paste token"
                  }
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={busy || !token.trim()}
                  onClick={() => applyConfig({ tunnelToken: token })}
                >
                  Save
                </Button>
              </div>
            </SettingsScreenField>
            <SettingsScreenField
              label="Public URL"
              caption="The hostname mapped to this machine in Cloudflare (e.g. wss://argus.example.com)."
            >
              <div className={styles.inlineForm}>
                <Input
                  placeholder="wss://argus.example.com"
                  value={publicUrl}
                  onChange={(e) => setPublicUrl(e.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={busy || !publicUrl.trim()}
                  onClick={() => applyConfig({ publicUrl })}
                >
                  Save
                </Button>
              </div>
            </SettingsScreenField>
          </>
        )}

        <SettingsScreenField
          label="Addresses"
          caption="Synced to every paired device on connect, in the order they're tried."
        >
          {status && status.endpoints.length > 0 ? (
            <ol className={styles.endpointList}>
              {status.endpoints.map((endpoint) => (
                <li key={endpoint.kind} className={styles.endpointRow}>
                  <span className={styles.endpointKind}>
                    {ENDPOINT_LABELS[endpoint.kind]}
                  </span>
                  <code className={styles.endpointUrl}>{endpoint.url}</code>
                </li>
              ))}
            </ol>
          ) : (
            <span className={styles.deviceMeta}>
              {enabled ? "resolving…" : "—"}
            </span>
          )}
        </SettingsScreenField>

        {status?.lanWebEnabled && (
          <SettingsScreenField
            label="Web client on this network"
            caption="With Local network on, Argus serves the web client to other devices on your Wi-Fi. Open this in a browser and pair it like any other device."
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

        <SettingsScreenField
          label="Pair a device"
          caption="Scan the QR on your phone, then confirm the 6-digit code matches on both screens."
        >
          {phase === "idle" ? (
            <Button
              variant="primary"
              disabled={!canPair}
              onClick={startPairing}
            >
              {canPair ? "Start pairing" : "Waiting for the tunnel…"}
            </Button>
          ) : (
            <div className={styles.pairing}>
              {phase === "starting" && (
                <p className={styles.muted}>Starting…</p>
              )}
              {qr && phase === "waiting-device" && (
                <>
                  <QrCode
                    value={qr.qrPayload}
                    size={200}
                    alt="Pairing QR code"
                  />
                  <p className={styles.muted}>
                    Or paste this code into the app:
                  </p>
                  <CopyableCode value={qr.pairingCode} />
                  <p className={styles.muted}>Waiting for the device…</p>
                  <Button variant="ghost" onClick={cancelPairing}>
                    Cancel
                  </Button>
                </>
              )}
              {phase === "awaiting-sas" && sas && (
                <>
                  <p className={styles.muted}>
                    Confirm this code matches the one on your device:
                  </p>
                  <div className={styles.sas}>{sas}</div>
                  <label className={styles.controlToggle}>
                    <Toggle checked={grantControl} onChange={setGrantControl} />
                    <span>
                      Allow this device to control agents (send messages, spawn
                      agents, create sessions)
                    </span>
                  </label>
                  <div className={styles.pairActions}>
                    <Button variant="ghost" onClick={cancelPairing}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={confirmPairing}>
                      Codes match — pair
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </SettingsScreenField>

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
                  onSetControl={setControl}
                />
              ))}
            </div>
          </SettingsScreenField>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
