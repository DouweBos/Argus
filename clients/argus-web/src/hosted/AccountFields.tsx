import { useEffect, useState } from "react";
import {
  AccountMemberList,
  Button,
  Input,
  SettingsScreenField,
} from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { addedLabel, memberKindLabel } from "./labels";

/** This browser's name on the account: renames it everywhere on save. */
export function NameField() {
  const current = useAccountStore((s) => s.name);
  const setName = useAccountStore((s) => s.setName);
  const [name, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  const dirty = name.trim() !== current && name.trim().length > 0;
  const save = () => void setName(name);

  return (
    <SettingsScreenField
      label="This browser's name"
      caption="What your other devices and computers call this browser on the account."
    >
      <div className="aw-settings-inline">
        <Input
          value={name}
          maxLength={64}
          placeholder="Name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) {
              save();
            }
          }}
        />
        <Button variant="secondary" disabled={!dirty} onClick={save}>
          Save
        </Button>
      </div>
    </SettingsScreenField>
  );
}

export function SignOutField() {
  const signOut = useAccountStore((s) => s.signOut);

  return (
    <SettingsScreenField
      label="Sign out"
      caption="Takes this browser off your account and deletes its key. You'll need approval again to come back."
    >
      <Button variant="danger" onClick={() => void signOut()}>
        Sign out
      </Button>
    </SettingsScreenField>
  );
}

/** Name, the account's devices and its safety code, and signing out. */
export function AccountFields() {
  const members = useAccountStore((s) => s.members);
  const ownId = useAccountStore((s) => s.ownId);
  const safetyCode = useAccountStore((s) => s.safetyCode);
  const approvalCode = useAccountStore((s) => s.approvalCode);

  const devices = members
    .filter((m) => m.role === "device")
    .map((m) => {
      const code = approvalCode(m.id);

      return {
        id: m.id,
        label: m.name,
        tag: m.id === ownId ? "This browser" : undefined,
        detail: [memberKindLabel(m), addedLabel(m), code && `code ${code}`]
          .filter(Boolean)
          .join(" · "),
      };
    });

  return (
    <div className="aw-settings">
      <NameField />
      <SettingsScreenField
        label="Devices"
        caption="Remove or rename devices from the Argus app on your iPhone or Mac."
      >
        <AccountMemberList members={devices} />
      </SettingsScreenField>
      {safetyCode && (
        <SettingsScreenField
          label="Account safety code"
          caption="The same on every device on your account. A different code means a different account."
        >
          <span className="aw-hosted-code">{safetyCode}</span>
        </SettingsScreenField>
      )}
      <SignOutField />
    </div>
  );
}
