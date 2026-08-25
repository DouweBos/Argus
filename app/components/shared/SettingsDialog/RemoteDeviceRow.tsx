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

export function RemoteDeviceRow({
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
          {device.push ? ` · push via ${PUSH_LABEL[device.push.service]}` : ""}
        </span>
      </div>
      <div className={styles.deviceActions}>
        {device.push && <PushTestButton deviceId={device.device_id} />}
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
