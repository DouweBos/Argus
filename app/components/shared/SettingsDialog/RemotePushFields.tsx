import type { RemotePushConfig } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  SettingsScreenField,
  StatusDot,
  TextArea,
  Toggle,
} from "@argus/peacock";
import { remoteGetPushConfig, remoteSetPushConfig } from "../../../lib/ipc";
import styles from "./RemoteAccessSection.module.css";

interface ApnsDraft {
  bundleId: string;
  keyId: string;
  keyP8: string;
  teamId: string;
}

const EMPTY_APNS: ApnsDraft = {
  bundleId: "",
  keyId: "",
  keyP8: "",
  teamId: "",
};

/**
 * Browsers need no credentials at all, so "no Apple/Firebase key" is a normal
 * state rather than an error — it only means phones won't get pushes.
 */
function pushReadiness(
  enabled: boolean,
  hasNativeCredentials: boolean,
): { label: string; tone: "idle" | "success" } {
  if (!enabled) {
    return { tone: "idle", label: "off" };
  }

  return hasNativeCredentials
    ? { tone: "success", label: "ready" }
    : { tone: "idle", label: "browsers only" };
}

/**
 * Credentials for pushing to a backgrounded phone. Argus talks to APNs and FCM
 * directly from this machine, so these are your own provider keys — there is no
 * Argus push server in the path.
 */
export function RemotePushFields({ disabled }: { disabled: boolean }) {
  const [config, setConfig] = useState<RemotePushConfig | null>(null);
  const [apns, setApns] = useState<ApnsDraft>(EMPTY_APNS);
  const [fcm, setFcm] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await remoteGetPushConfig();
      setConfig(next);
      setApns({
        bundleId: next.apnsBundleId,
        keyId: next.apnsKeyId,
        teamId: next.apnsTeamId,
        keyP8: "",
      });
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

  const saveApns = async () => {
    await save({
      apnsBundleId: apns.bundleId,
      apnsKeyId: apns.keyId,
      apnsTeamId: apns.teamId,
      // An empty box means "keep the stored key" — we never read it back out.
      ...(apns.keyP8.trim() ? { apnsKeyP8: apns.keyP8 } : {}),
    });
    setApns((prev) => ({ ...prev, keyP8: "" }));
  };

  const saveFcm = async () => {
    await save({ fcmServiceAccount: fcm });
    setFcm("");
  };

  const enabled = config?.enabled ?? false;
  const hasNativeCredentials = Boolean(
    config && (config.apnsConfigured || config.fcmConfigured),
  );
  const readiness = pushReadiness(enabled, hasNativeCredentials);

  return (
    <>
      <SettingsScreenField
        label="Background push"
        caption="Wake paired phones with a real notification when they're not connected — agent finished, agent failed, or a prompt needs approval. Argus signs and sends these to Apple and Google itself; nothing routes through an Argus server."
      >
        <div className={styles.toggleRow}>
          <Toggle
            checked={enabled}
            disabled={disabled || busy}
            onChange={(next) => save({ enabled: next })}
          />
          {config && (
            <StatusDot tone={readiness.tone} label={readiness.label} />
          )}
        </div>
      </SettingsScreenField>

      {enabled && (
        <>
          <SettingsScreenField
            label="Apple push (iOS)"
            caption={
              config?.apnsConfigured
                ? "A key is stored. Paste a new .p8 to replace it, or leave it empty to keep the current one."
                : "From Apple Developer → Keys → a key with the Apple Push Notifications service enabled. The bundle id is the phone app's — dev.houwert.argus.remote unless you rebuilt it."
            }
          >
            <div className={styles.pushForm}>
              <Input
                placeholder="Key ID"
                value={apns.keyId}
                disabled={disabled || busy}
                onChange={(e) =>
                  setApns((p) => ({ ...p, keyId: e.target.value }))
                }
              />
              <Input
                placeholder="Team ID"
                value={apns.teamId}
                disabled={disabled || busy}
                onChange={(e) =>
                  setApns((p) => ({ ...p, teamId: e.target.value }))
                }
              />
              <Input
                placeholder="Bundle identifier"
                value={apns.bundleId}
                disabled={disabled || busy}
                onChange={(e) =>
                  setApns((p) => ({ ...p, bundleId: e.target.value }))
                }
              />
              <TextArea
                mono
                rows={4}
                placeholder={
                  config?.apnsConfigured
                    ? "•••• stored ••••"
                    : "-----BEGIN PRIVATE KEY-----"
                }
                value={apns.keyP8}
                disabled={disabled || busy}
                onChange={(e) =>
                  setApns((p) => ({ ...p, keyP8: e.target.value }))
                }
              />
              <Button
                variant="secondary"
                disabled={disabled || busy}
                onClick={saveApns}
              >
                Save Apple credentials
              </Button>
            </div>
          </SettingsScreenField>

          <SettingsScreenField
            label="Firebase push (Android)"
            caption={
              config?.fcmConfigured
                ? `Service account stored for project ${config.fcmProjectId ?? "unknown"}. Paste a new one to replace it.`
                : "From Firebase → Project settings → Service accounts → Generate new private key. Paste the whole JSON file."
            }
          >
            <div className={styles.pushForm}>
              <TextArea
                mono
                rows={4}
                placeholder={
                  config?.fcmConfigured
                    ? "•••• stored ••••"
                    : '{ "type": "service_account", … }'
                }
                value={fcm}
                disabled={disabled || busy}
                onChange={(e) => setFcm(e.target.value)}
              />
              <Button
                variant="secondary"
                disabled={disabled || busy || !fcm.trim()}
                onClick={saveFcm}
              >
                Save Firebase credentials
              </Button>
            </div>
          </SettingsScreenField>
        </>
      )}

      {enabled && (
        <SettingsScreenField
          label="Browsers (Web Push)"
          caption="Nothing to configure — Argus generates its own signing key the first time a browser subscribes. The contact below is what push services (Mozilla, Google, Apple) use to reach you if a message misbehaves."
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
            {config?.webPushConfigured
              ? "Signing key ready."
              : "Signing key is created the first time a browser turns background push on."}
          </p>
        </SettingsScreenField>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
