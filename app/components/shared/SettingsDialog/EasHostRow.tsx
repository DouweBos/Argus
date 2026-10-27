/** A saved EAS Simulator host: its limits, an account check, edit and remove. */

import type { EasDeviceHost } from "../../../lib/types";
import { useState } from "react";
import { Button, StatusBulb, type StatusBulbTone } from "@argus/peacock";
import { describeEasAccount, describeEasHost } from "../../../lib/deviceHost";
import { checkEasAccount, removeEasDeviceHost } from "../../../lib/ipc";
import styles from "./DeviceHostsField.module.css";
import { EasHostForm } from "./EasHostForm";

const errorText = (e: unknown) => (typeof e === "string" ? e : String(e));

function toneOf(host: EasDeviceHost): StatusBulbTone {
  if (host.error) {
    return "error";
  }

  return host.runningSessions > 0 ? "success" : "neutral";
}

export function EasHostRow({
  host,
  onChanged,
}: {
  host: EasDeviceHost;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = () => {
    setBusy(true);
    setError(null);
    checkEasAccount({ hostId: host.id })
      .then(
        (a) => setMessage(describeEasAccount(a)),
        (e: unknown) => setError(errorText(e)),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    removeEasDeviceHost(host.id).then(onChanged, (e: unknown) => {
      setBusy(false);
      setError(errorText(e));
    });
  };

  if (editing) {
    return (
      <EasHostForm
        host={host}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  const shown = error ?? message ?? host.error;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <StatusBulb tone={toneOf(host)} />
        <div className={styles.text}>
          <span className={styles.name}>{host.label}</span>
          <span className={styles.target}>
            EAS Simulator · {describeEasHost(host)}
          </span>
        </div>
        <Button disabled={busy} onClick={check} size="sm" variant="secondary">
          Check account
        </Button>
        <Button
          disabled={busy}
          onClick={() => setEditing(true)}
          size="sm"
          variant="ghost"
        >
          Edit
        </Button>
        <Button disabled={busy} onClick={remove} size="sm" variant="ghost">
          Remove
        </Button>
      </div>
      {shown && (
        <p
          className={
            error || (!message && host.error) ? styles.error : styles.status
          }
        >
          {shown}
        </p>
      )}
    </div>
  );
}
