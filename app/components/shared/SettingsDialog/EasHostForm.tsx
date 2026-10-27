/**
 * Add or edit an EAS Simulator host: label, Expo token, EAS project and the
 * limits that bound what each session can bill. The token is write-only: the
 * host never sends a saved one back.
 */

import type {
  EasAccount,
  EasDeviceHost,
  EasDeviceHostInput,
} from "../../../lib/types";
import { type FormEvent, useState } from "react";
import { Button, Input, Select, Spinner } from "@argus/peacock";
import { describeEasAccount } from "../../../lib/deviceHost";
import {
  addEasDeviceHost,
  checkEasAccount,
  updateEasDeviceHost,
} from "../../../lib/ipc";
import styles from "./DeviceHostsField.module.css";

const errorText = (e: unknown) => (typeof e === "string" ? e : String(e));

interface Draft {
  appId: string;
  idleMinutes: string;
  label: string;
  maxConcurrentSessions: string;
  maxSessionMinutes: string;
  token: string;
}

function draftOf(host?: EasDeviceHost): Draft {
  return {
    label: host?.label ?? "",
    token: "",
    appId: host?.appId ?? "",
    maxSessionMinutes: String(host?.maxSessionMinutes ?? 30),
    idleMinutes: String(host?.idleMinutes ?? 10),
    maxConcurrentSessions: String(host?.maxConcurrentSessions ?? 2),
  };
}

const LIMITS = [
  ["maxSessionMinutes", "Session minutes", "1–115 (free accounts: 40)"],
  ["idleMinutes", "Idle minutes", "1–60, below session minutes"],
  ["maxConcurrentSessions", "Concurrent sessions", "1–20"],
] as const;

export function EasHostForm({
  host,
  onCancel,
  onSaved,
}: {
  /** Absent for a new host. */
  host?: EasDeviceHost;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(host));
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<EasAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };

  const num = (value: string) => (value.trim() ? Number(value) : null);

  const input = (): EasDeviceHostInput => ({
    label: draft.label || null,
    // Editing: empty keeps the saved token.
    token: draft.token || (host ? null : ""),
    appId: draft.appId,
    maxSessionMinutes: num(draft.maxSessionMinutes),
    idleMinutes: num(draft.idleMinutes),
    maxConcurrentSessions: num(draft.maxConcurrentSessions),
  });

  const check = () => {
    setBusy(true);
    setError(null);
    checkEasAccount({ hostId: host?.id ?? null, token: draft.token || null })
      .then(setAccount, (e: unknown) => {
        setAccount(null);
        setError(errorText(e));
      })
      .finally(() => setBusy(false));
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    (host ? updateEasDeviceHost(host.id, input()) : addEasDeviceHost(input()))
      .then(
        () => {
          setDraft(draftOf());
          setAccount(null);
          onSaved();
        },
        (err: unknown) => setError(errorText(err)),
      )
      .finally(() => setBusy(false));
  };

  const clearToken = () => {
    if (!host) {
      return;
    }
    setBusy(true);
    updateEasDeviceHost(host.id, { token: "" })
      .then(onSaved, (err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const tokenPlaceholder = host?.hasToken
    ? "Access token saved (type to replace)"
    : "Expo access token (empty: EXPO_TOKEN or eas login)";

  return (
    <form className={styles.form} onSubmit={save}>
      <div className={styles.fields}>
        <Input
          aria-label="Expo access token"
          autoComplete="off"
          mono
          onChange={(e) => set("token")(e.target.value)}
          placeholder={tokenPlaceholder}
          type="password"
          value={draft.token}
        />
        <Input
          aria-label="Label"
          onChange={(e) => set("label")(e.target.value)}
          placeholder="Label (optional)"
          value={draft.label}
        />
      </div>
      {account && account.apps.length > 0 ? (
        <Select
          aria-label="EAS project"
          onChange={(e) => set("appId")(e.target.value)}
          value={draft.appId}
        >
          <option value="">
            {account.apps.length === 1
              ? "The account's only project"
              : "Choose an EAS project"}
          </option>
          {account.apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.fullName}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          aria-label="EAS project ID"
          mono
          onChange={(e) => set("appId")(e.target.value)}
          placeholder="EAS project ID (optional with one project; Check account lists them)"
          value={draft.appId}
        />
      )}
      <div className={styles.limits}>
        {LIMITS.map(([key, label, hint]) => (
          <label className={styles.limit} key={key}>
            <span className={styles.limitLabel}>{label}</span>
            <Input
              inputMode="numeric"
              mono
              onChange={(e) => set(key)(e.target.value)}
              title={hint}
              value={draft[key]}
            />
          </label>
        ))}
      </div>
      <p className={styles.status}>
        Each device you open starts an EAS Simulator session billed to the Expo
        account until it is closed, goes idle, or hits its session minutes.
      </p>
      <div className={styles.actions}>
        <Button
          disabled={busy}
          onClick={check}
          size="sm"
          type="button"
          variant="secondary"
        >
          Check account
        </Button>
        <Button disabled={busy} size="sm" type="submit">
          {host ? "Save" : "Add EAS host"}
        </Button>
        {host?.hasToken && (
          <Button
            disabled={busy}
            onClick={clearToken}
            size="sm"
            type="button"
            variant="ghost"
          >
            Forget token
          </Button>
        )}
        {onCancel && (
          <Button
            disabled={busy}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        )}
        {busy && <Spinner size="xs" />}
      </div>
      {(error ?? account) && (
        <p className={error ? styles.error : styles.status}>
          {error ?? (account ? describeEasAccount(account) : null)}
        </p>
      )}
    </form>
  );
}
