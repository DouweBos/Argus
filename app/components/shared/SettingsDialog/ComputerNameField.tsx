import type { AccountStatus } from "../../../lib/types";
import { useState } from "react";
import { Input, SettingsScreenField } from "@argus/peacock";
import { normalizeMemberName } from "@argus/remote-protocol";
import { accountSetName } from "../../../lib/ipc";
import styles from "./AccountSection.module.css";

/**
 * This computer's name, saved on blur or Enter; empty goes back to the system
 * name. Keyed on the saved name by its parent, so a rename from another device
 * resets the draft.
 */
export function ComputerNameField({ status }: { status: AccountStatus }) {
  const name = status.name ?? "";
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === name) {
      setDraft(name);

      return;
    }
    if (trimmed !== "" && normalizeMemberName(trimmed) === null) {
      setError("Names are 1–64 characters on one line");

      return;
    }
    setError(null);
    accountSetName(trimmed === "" ? null : trimmed).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };

  return (
    <SettingsScreenField
      label="This computer's name"
      caption={
        status.linked
          ? "How your phone and other computers list this computer and this window. Changing it renames them on your account."
          : "How your phone and other computers will list this computer once it's linked. Leave empty for the system name."
      }
    >
      <Input
        aria-label="This computer's name"
        maxLength={64}
        placeholder={status.system_name}
        value={draft}
        onBlur={commit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
          }
        }}
      />
      {error && <p className={styles.error}>{error}</p>}
    </SettingsScreenField>
  );
}
