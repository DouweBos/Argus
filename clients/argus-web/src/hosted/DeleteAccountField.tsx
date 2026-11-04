import { useId, useState } from "react";
import { Banner, Button, ConfirmDialog, SettingsScreenField } from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { describeAccountError } from "../account/client";

/** Deletes the account on the service, after Clerk checks it's really you. */
export function DeleteAccountField() {
  const deleteAccount = useAccountStore((s) => s.deleteAccount);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const confirm = async () => {
    setError(null);
    try {
      if (await deleteAccount()) {
        setConfirming(false);
      }
    } catch (err) {
      setError(describeAccountError(err));
    }
  };

  return (
    <SettingsScreenField
      label="Delete account"
      caption="Removes every device and computer from your Argus account at once."
    >
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete account…
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Delete your Argus account?"
          titleId={titleId}
          confirmLabel="Delete account"
          destructive
          onCancel={() => {
            setConfirming(false);
            setError(null);
          }}
          onConfirm={confirm}
        >
          {error && <Banner tone="error">{error}</Banner>}
          <p>
            Every device and computer on the account loses it, this browser
            included. The service forgets their addresses and closes their
            tunnels; pairings made with a QR code keep working.
          </p>
          <p>
            To start over, sign in on the Argus app on your iPhone or Mac, then
            link each computer again from its own console. You&rsquo;ll be
            asked to confirm it&rsquo;s you first.
          </p>
        </ConfirmDialog>
      )}
    </SettingsScreenField>
  );
}
