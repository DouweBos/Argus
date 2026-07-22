import type {
  RemoteDevice,
  RemoteStatus,
  RemoteTunnelMode,
  RemoteTunnelProvider,
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

type PairPhase = "awaiting-sas" | "idle" | "starting" | "waiting-device";

const PROVIDER_OPTIONS = [
  { value: "none" as const, label: "LAN only" },
  { value: "cloudflare" as const, label: "Cloudflare" },
  { value: "tailscale" as const, label: "Tailscale" },
];

const MODE_OPTIONS = [
  { value: "quick" as const, label: "Quick tunnel" },
  { value: "token" as const, label: "Named tunnel" },
];

function lastSeenLabel(ts: number | null): string {
  if (!ts) {
    return "never connected";
  }
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);

  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

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

function tunnelTone(status: string): "error" | "idle" | "success" {
  if (status === "running") {
    return "success";
  }

  return status === "error" ? "error" : "idle";
}

function DeviceRow({
  device,
  connected,
  onRevoke,
  onSetControl,
  busy,
}: {
  busy: boolean;
  connected: boolean;
  device: RemoteDevice;
  onRevoke: (id: string) => void;
  onSetControl: (id: string, control: boolean) => void;
}) {
  const hasControl = device.capabilities.includes("control");

  return (
    <div className={styles.device}>
      <div className={styles.deviceInfo}>
        <span className={styles.deviceLabel}>{device.label}</span>
        <span className={styles.deviceMeta}>
          {connected ? (
            <StatusDot tone="success" pulse label="connected" />
          ) : (
            lastSeenLabel(device.last_seen)
          )}{" "}
          · {hasControl ? "monitor + control" : "monitor only"}
        </span>
      </div>
      <div className={styles.deviceActions}>
        <label className={styles.controlToggle}>
          <span>Control</span>
          <Toggle
            checked={hasControl}
            disabled={busy}
            onChange={(next) => onSetControl(device.device_id, next)}
          />
        </label>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => onRevoke(device.device_id)}
        >
          Revoke
        </Button>
      </div>
    </div>
  );
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
    enabled?: boolean;
    lanWeb?: boolean;
    provider?: RemoteTunnelProvider;
    publicUrl?: string;
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
  const provider = status?.provider ?? "cloudflare";
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
          caption="Starts the local gateway and the Cloudflare tunnel."
        >
          <div className={styles.toggleRow}>
            <Toggle
              checked={enabled}
              disabled={busy}
              onChange={(next) => applyConfig({ enabled: next })}
            />
            {status && (
              <StatusDot
                tone={enabled ? tunnelTone(status.tunnelStatus) : "idle"}
                label={enabled ? status.tunnelStatus : "off"}
              />
            )}
          </div>
        </SettingsScreenField>

        <SettingsScreenField
          label="Provider"
          caption="How to reach the gateway off your network. LAN only = no tunnel, no external process (pair over Wi-Fi below). Cloudflare/Tailscale expose it beyond the LAN and need that provider's CLI on your PATH; traffic stays end-to-end encrypted either way."
        >
          <SegmentedControl<RemoteTunnelProvider>
            aria-label="Tunnel provider"
            value={provider}
            options={PROVIDER_OPTIONS}
            onChange={(p) => applyConfig({ provider: p })}
          />
        </SettingsScreenField>

        {provider === "tailscale" && (
          <SettingsScreenField label="Tailscale Funnel">
            <p className={styles.muted}>
              Uses `tailscale funnel` to expose the gateway at your stable
              `*.ts.net` address — no domain or Cloudflare account. Requires the
              tailscale CLI, signed into a tailnet with Funnel enabled.
            </p>
          </SettingsScreenField>
        )}

        {provider === "cloudflare" && (
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

        {provider === "cloudflare" && mode === "token" && (
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

        <SettingsScreenField label="Current address">
          <span className={styles.deviceMeta}>
            {status?.publicUrl ?? (enabled ? "resolving…" : "—")}
          </span>
        </SettingsScreenField>

        <SettingsScreenField
          label="Web client on this network"
          caption="Serve the web client to other devices on your Wi-Fi. Open the address below in a browser and pair it like any other device — access is still gated by pairing."
        >
          <div className={styles.toggleRow}>
            <Toggle
              checked={status?.lanWebEnabled ?? false}
              disabled={busy || !enabled}
              onChange={(next) => applyConfig({ lanWeb: next })}
            />
            {status?.lanWebEnabled && (
              <span className={styles.deviceMeta}>
                {status.lanUrl
                  ? status.lanUrl.replace(/^ws:/, "http:")
                  : "no LAN address"}
              </span>
            )}
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
                <DeviceRow
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

        {(error || status?.tunnelError) && (
          <p className={styles.error}>{error ?? status?.tunnelError}</p>
        )}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
