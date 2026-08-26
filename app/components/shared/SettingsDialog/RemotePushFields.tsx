import type { RemotePushConfig } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  SettingsScreenField,
  StatusDot,
  Toggle,
} from "@argus/peacock";
import { remoteGetPushConfig, remoteSetPushConfig } from "../../../lib/ipc";
import styles from "./RemoteAccessSection.module.css";

/**
 * Background push settings. There is nothing to configure: browsers get a
 * signing key Argus generates itself, and phones go through the relay, which
 * holds the Apple credentials so they never have to ship in this app.
 */
export function RemotePushFields({ disabled }: { disabled: boolean }) {
  const [config, setConfig] = useState<RemotePushConfig | null>(null);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await remoteGetPushConfig();
      setConfig(next);
      setSubject(next.vapidSubject);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Parameters<typeof remoteSetPushConfig>[0]) => {
    setBusy(true);
    setError(null);
    try {
      setConfig(await remoteSetPushConfig(patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = config?.enabled ?? false;

  return (
    <>
      <SettingsScreenField
        label="Background push"
        caption="Wake paired phones and browsers with a real notification when they're not connected — agent finished, agent failed, or a prompt needs approval. Nothing to set up: every notification is encrypted for the device it's going to before it leaves this machine."
      >
        <div className={styles.toggleRow}>
          <Toggle
            checked={enabled}
            disabled={disabled || busy}
            onChange={(next) => save({ enabled: next })}
          />
          {config && (
            <StatusDot
              tone={enabled ? "success" : "idle"}
              label={enabled ? "ready" : "off"}
            />
          )}
        </div>
      </SettingsScreenField>

      {enabled && (
        <SettingsScreenField
          label="Push service contact"
          caption="What Mozilla, Google, and Apple use to reach you if a browser notification misbehaves. Never shown to anyone else."
        >
          <div className={styles.pushForm}>
            <Input
              placeholder="mailto:you@example.com"
              value={subject}
              disabled={disabled || busy}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={disabled || busy || !subject.trim()}
              onClick={() => save({ vapidSubject: subject })}
            >
              Save contact
            </Button>
          </div>
          <p className={styles.muted}>
            Phones are reached through {config?.relayUrl ?? "the Argus relay"},
            which only ever handles ciphertext.
          </p>
        </SettingsScreenField>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
