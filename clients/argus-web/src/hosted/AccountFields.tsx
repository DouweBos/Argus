import type { AccountMember } from "@argus/remote-protocol/account";
import { useEffect, useState } from "react";
import {
  AccountMemberActions,
  AccountMemberList,
  Banner,
  Button,
  Input,
  SettingsScreenField,
} from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { presenceLabel } from "../account/directory";
import { DeleteAccountField } from "./DeleteAccountField";
import { handOverToComputers } from "./handOver";
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

/** Name, the account's devices and computers, its safety code, signing out and deleting it. */
export function AccountFields() {
  const members = useAccountStore((s) => s.members);
  const computers = useAccountStore((s) => s.computers);
  const ownId = useAccountStore((s) => s.ownId);
  const safetyCode = useAccountStore((s) => s.safetyCode);
  const approvalCode = useAccountStore((s) => s.approvalCode);
  const renameMember = useAccountStore((s) => s.renameMember);
  const removeMember = useAccountStore((s) => s.removeMember);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const actions = (m: AccountMember) => (
    <AccountMemberActions
      name={m.name}
      canRename
      canRemove={m.id !== ownId}
      onRename={(name) => renameMember(m.id, name)}
      onRemove={() => removeMember(m.id, handOverToComputers)}
      onChanged={() => setError(null)}
      onError={setError}
    />
  );
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
        actions: actions(m),
      };
    });
  const hosts = members
    .filter((m) => m.role === "host")
    .map((m) => {
      const computer = computers.find((c) => c.id === m.id);

      return {
        id: m.id,
        label: m.name,
        tone: computer?.online ? ("success" as const) : ("neutral" as const),
        detail: [memberKindLabel(m), computer && presenceLabel(computer, now)]
          .filter(Boolean)
          .join(" · "),
        actions: actions(m),
      };
    });

  return (
    <div className="aw-settings">
      {error && <Banner tone="error">{error}</Banner>}
      <NameField />
      <SettingsScreenField
        label="Devices"
        caption="Removing a device disconnects it from every computer on the account. It needs approval from a device in the Argus app to come back."
      >
        <AccountMemberList members={devices} />
      </SettingsScreenField>
      <SettingsScreenField
        label="Computers"
        caption="Removing a computer takes it off the account; link it again from its own console. Pairings made with a QR code keep working."
      >
        <AccountMemberList
          members={hosts}
          emptyText="No computers on your account yet."
        />
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
      <DeleteAccountField />
    </div>
  );
}
