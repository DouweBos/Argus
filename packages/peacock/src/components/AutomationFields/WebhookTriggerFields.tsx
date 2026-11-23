import type { RemoteWebhookTrigger } from "@argus/remote-protocol";
import { useState } from "react";
import { Button } from "../Button/Button";
import { CopyField } from "../CopyField/CopyField";
import { FormField } from "../FormField/FormField";
import styles from "./AutomationFields.module.css";
import { PacingFields, type Pacing } from "./PacingFields";

/** The webhook's URL, its once-shown secret, and its pacing. */
export function WebhookTriggerFields({
  disabled,
  webhook,
  onChange,
  onRotateSecret,
}: {
  disabled?: boolean;
  webhook: RemoteWebhookTrigger;
  onChange: (pacing: Pacing) => void;
  /** Omit when this client may not, or the automation isn't saved yet. */
  onRotateSecret?: () => Promise<{ url: string | null; secret: string }>;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(webhook.url);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasSecret = webhook.has_secret || secret !== null;

  const rotate = async () => {
    if (!onRotateSecret) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onRotateSecret();
      setSecret(result.secret);
      setUrl(result.url);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.schedule}>
      <p className={styles.caption}>
        Runs when something posts to this address with the secret — a GitHub
        webhook signs with it (X-Hub-Signature-256), anything else can send it
        as a bearer token. The posted JSON is handed to the run.
      </p>
      <FormField
        label="URL"
        helper={
          url ? undefined : "Turn on remote access to give it a public address."
        }
      >
        <CopyField value={url ?? ""} placeholder="No address yet" />
      </FormField>
      <FormField
        label="Secret"
        error={error ?? undefined}
        helper={
          secret
            ? "Copy it now — it won't be shown again."
            : onRotateSecret
              ? undefined
              : "Save the automation to make a secret."
        }
      >
        {secret ? (
          <CopyField value={secret} copyLabel="Copy secret" />
        ) : (
          <p className={styles.caption}>
            {hasSecret ? "Set. Regenerate it to see a new one." : "None yet."}
          </p>
        )}
      </FormField>
      {onRotateSecret && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || busy}
            onClick={() => {
              rotate().catch(() => {});
            }}
          >
            {hasSecret ? "Regenerate secret" : "Generate secret"}
          </Button>
        </div>
      )}
      <PacingFields disabled={disabled} pacing={webhook} onChange={onChange} />
    </div>
  );
}
