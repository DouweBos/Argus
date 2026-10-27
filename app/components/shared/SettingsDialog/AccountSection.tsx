import type { AccountLinkState, AccountStatus } from "../../../lib/types";
import { useState } from "react";
import {
  Button,
  CopyField,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
} from "@argus/peacock";
import { useAccountStatus } from "../../../hooks/useAccountStatus";
import {
  accountLoginCancel,
  accountLoginStart,
  accountLogout,
  openExternalUrl,
} from "../../../lib/ipc";
import { AccountComputers } from "./AccountComputers";
import styles from "./AccountSection.module.css";
import { AccountSettingsFields } from "./AccountSettingsFields";

const LINKING_COPY: Partial<Record<AccountLinkState["kind"], string>> = {
  awaiting_first:
    "Confirm in the dialog to make this the account's first computer.",
  awaiting_sas:
    "Compare the code in the dialog with the one on your other device.",
  awaiting_approval: "Confirmed here. Waiting for your other device to finish…",
};

function LinkFlow({ link }: { link: AccountLinkState }) {
  if (link.kind === "awaiting_claim") {
    return (
      <div className={styles.flow}>
        <CopyField value={link.user_code} copyLabel="Copy code" />
        <p className={styles.muted}>
          Type this code into the Argus app on your phone or Mac (Settings →
          Account → Add a computer), or enter it at {link.verification_uri} and
          approve it from your phone.
        </p>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => accountLoginCancel().catch(() => undefined)}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              openExternalUrl(link.verification_uri_complete).catch(
                () => undefined,
              )
            }
          >
            Open the link page
          </Button>
        </div>
      </div>
    );
  }
  const copy = LINKING_COPY[link.kind];

  return copy ? <p className={styles.muted}>{copy}</p> : null;
}

function SignedOut({ status }: { status: AccountStatus }) {
  const [error, setError] = useState<string | null>(null);
  const link = status.link;
  const linking = link.kind !== "idle" && link.kind !== "error";

  return (
    <SettingsScreenField
      label="Link this computer"
      caption="Puts this computer and this window on your Argus account, so your phone and other computers find it without a pairing code. Your browser opens on a short code; approve it from your phone."
    >
      {linking ? (
        <LinkFlow link={link} />
      ) : (
        <div className={styles.flow}>
          <div>
            <Button
              variant="primary"
              onClick={() =>
                accountLoginStart().catch((e: unknown) => setError(String(e)))
              }
            >
              Link this computer
            </Button>
          </div>
          {link.kind === "error" && (
            <p className={styles.error}>{link.message}</p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </SettingsScreenField>
  );
}

/** Settings → Account: link this computer and see the account's computers. */
export function AccountSection() {
  const { status } = useAccountStatus();

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        title="Account"
        description="Sign in once and your computers find each other. The account service only introduces them — every change is signed by your own devices, and traffic never passes through it."
      />
      <SettingsScreenDetailBody>
        {status && !status.linked && <SignedOut status={status} />}
        {status?.linked && (
          <>
            <SettingsScreenField
              label="Account safety code"
              caption="The same on every device on this account. Compare it with the one on your phone for a quick by-eye check."
            >
              <span className={styles.code}>{status.safety_code}</span>
              {status.log_error && (
                <p className={styles.error}>
                  The account service sent changes that didn&apos;t check out (
                  {status.log_error}). This computer keeps the last good state.
                </p>
              )}
            </SettingsScreenField>
            <AccountComputers />
            <AccountSettingsFields config={status.config} />
            <SettingsScreenField
              label="Unlink this computer"
              caption="Removes this computer and this window from the account. Devices you paired with a code keep working."
            >
              <div>
                <Button
                  variant="danger"
                  onClick={() => accountLogout().catch(() => undefined)}
                >
                  Unlink
                </Button>
              </div>
            </SettingsScreenField>
          </>
        )}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
