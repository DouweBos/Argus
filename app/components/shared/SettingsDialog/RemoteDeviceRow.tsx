import type { RemoteDevice } from "../../../lib/types";
import { useState } from "react";
import { Button, StatusDot, Toggle } from "@argus/peacock";
import { remoteTestPush } from "../../../lib/ipc";
import styles from "./RemoteAccessSection.module.css";

/** How a device's registered push channel reads in the paired list. */
const PUSH_LABEL: Record<"apns" | "fcm" | "webpush", string> = {
  apns: "Apple",
  fcm: "Firebase",
  webpush: "Web Push",
};

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

/** Send a test push and report the provider's answer inline. */
function PushTestButton({ deviceId }: { deviceId: string }) {
  const [result, setResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await remoteTestPush(deviceId);
      setResult(r.delivered ? "sent" : (r.reason ?? "failed"));
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <span className={styles.devicePush}>
      <Button variant="ghost" disabled={sending} onClick={send}>
        Test push
      </Button>
      {result && <span className={styles.deviceMeta}>{result}</span>}
    </span>
  );
}

/** How a device's grants read in the paired list. */
function grantLabel(capabilities: string[]): string {
  if (capabilities.includes("admin")) {
    return "full control (admin)";
  }

  return capabilities.includes("control")
    ? "monitor + control"
    : "monitor only";
}

export function RemoteDeviceRow({
  device,
  connected,
  onRevoke,
  onSetGrants,
  busy,
}: {
  busy: boolean;
  connected: boolean;
  device: RemoteDevice;
  onRevoke: (id: string) => void;
  onSetGrants: (
    id: string,
    grants: { admin: boolean; control: boolean },
  ) => void;
}) {
  const hasAdmin = device.capabilities.includes("admin");
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
          · {grantLabel(device.capabilities)}
          {device.push ? ` · push via ${PUSH_LABEL[device.push.service]}` : ""}
        </span>
      </div>
      <div className={styles.deviceActions}>
        {device.push && <PushTestButton deviceId={device.device_id} />}
        <label className={styles.controlToggle}>
          <span>Control</span>
          <Toggle
            checked={hasControl}
            disabled={busy || hasAdmin}
            onChange={(next) =>
              onSetGrants(device.device_id, { control: next, admin: hasAdmin })
            }
          />
        </label>
        <label
          className={styles.controlToggle}
          title="Let this Mac drive Argus here as if sitting at the keyboard. Only for another Mac you own."
        >
          <span>Admin</span>
          <Toggle
            checked={hasAdmin}
            disabled={busy}
            onChange={(next) =>
              onSetGrants(device.device_id, {
                control: hasControl || next,
                admin: next,
              })
            }
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
