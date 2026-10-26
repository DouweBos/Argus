/**
 * Settings → Tools → Device hosts: other Macs whose iOS simulators Argus
 * streams over SSH. The host owns the config and the SSH connections; this
 * lists, adds, tests and removes them.
 */

import type {
  DeviceHost,
  DeviceHostInput,
  DeviceHostTestResult,
} from "../../../lib/types";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  SettingsScreenField,
  Spinner,
  StatusBulb,
  type StatusBulbTone,
} from "@argus/peacock";
import {
  addDeviceHost,
  listDeviceHosts,
  removeDeviceHost,
  testDeviceHost,
} from "../../../lib/ipc";
import styles from "./DeviceHostsField.module.css";

const STATUS_TONE: Record<DeviceHost["status"], StatusBulbTone> = {
  connected: "success",
  unknown: "neutral",
  unreachable: "error",
};

const errorText = (e: unknown) => (typeof e === "string" ? e : String(e));

function describeTarget(h: Pick<DeviceHost, "port" | "target">): string {
  return h.port ? `${h.target}:${String(h.port)}` : h.target;
}

export function DeviceHostsField() {
  const [hosts, setHosts] = useState<DeviceHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listDeviceHosts().then(setHosts, (e: unknown) => setError(errorText(e)));
  }, []);

  useEffect(reload, [reload]);

  return (
    <SettingsScreenField
      caption="Stream and drive iOS simulators running on another Mac. Argus connects with this Mac's SSH config and keys, never prompts for a password, and installs its bridge on the other Mac on first use."
      label="Device hosts"
    >
      <div className={styles.list}>
        {hosts === null && !error && <Spinner size="xs" />}
        {hosts?.map((host) => (
          <HostRow
            host={host}
            key={host.id}
            onRemoved={reload}
            onTested={reload}
          />
        ))}
        {error && <p className={styles.error}>{error}</p>}
        <AddHostForm onAdded={reload} />
      </div>
    </SettingsScreenField>
  );
}

function HostRow({
  host,
  onRemoved,
  onTested,
}: {
  host: DeviceHost;
  onRemoved: () => void;
  onTested: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceHostTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = () => {
    setBusy(true);
    const { target, port, identityFile, label } = host;
    testDeviceHost({ target, port, identityFile, label })
      .then(setResult, (e: unknown) => setError(errorText(e)))
      .finally(() => {
        setBusy(false);
        onTested();
      });
  };

  const remove = () => {
    setBusy(true);
    removeDeviceHost(host.id).then(onRemoved, (e: unknown) => {
      setBusy(false);
      setError(errorText(e));
    });
  };

  const message = error ?? result?.message ?? host.error;
  const failed = error !== null || (result ? !result.ok : host.error !== null);

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <StatusBulb tone={STATUS_TONE[host.status]} />
        <div className={styles.text}>
          <span className={styles.name}>{host.label}</span>
          <span className={styles.target}>
            {describeTarget(host)}
            {host.identityFile ? ` · ${host.identityFile}` : ""}
          </span>
        </div>
        <Button disabled={busy} onClick={test} size="sm" variant="secondary">
          Test
        </Button>
        <Button disabled={busy} onClick={remove} size="sm" variant="ghost">
          Remove
        </Button>
      </div>
      {message && (
        <p className={failed ? styles.error : styles.status}>{message}</p>
      )}
    </div>
  );
}

const EMPTY = { target: "", port: "", identityFile: "", label: "" };

function AddHostForm({ onAdded }: { onAdded: () => void }) {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceHostTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = (): DeviceHostInput => ({
    target: draft.target,
    port: draft.port.trim() ? Number(draft.port) : null,
    identityFile: draft.identityFile || null,
    label: draft.label || null,
  });

  const set = (key: keyof typeof EMPTY) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setResult(null);
    setError(null);
  };

  const test = () => {
    setBusy(true);
    setError(null);
    testDeviceHost(input())
      .then(setResult, (e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    addDeviceHost(input())
      .then(
        () => {
          setDraft(EMPTY);
          setResult(null);
          onAdded();
        },
        (err: unknown) => setError(errorText(err)),
      )
      .finally(() => setBusy(false));
  };

  const empty = !draft.target.trim();

  return (
    <form className={styles.form} onSubmit={add}>
      <div className={styles.fields}>
        <Input
          aria-label="SSH target"
          mono
          onChange={(e) => set("target")(e.target.value)}
          placeholder="SSH alias or user@host"
          value={draft.target}
        />
        <Input
          aria-label="Port"
          inputMode="numeric"
          mono
          onChange={(e) => set("port")(e.target.value)}
          placeholder="Port"
          value={draft.port}
        />
        <Input
          aria-label="Identity file"
          mono
          onChange={(e) => set("identityFile")(e.target.value)}
          placeholder="Identity file (optional)"
          value={draft.identityFile}
        />
        <Input
          aria-label="Label"
          onChange={(e) => set("label")(e.target.value)}
          placeholder="Label (optional)"
          value={draft.label}
        />
      </div>
      <div className={styles.actions}>
        <Button
          disabled={busy || empty}
          onClick={test}
          size="sm"
          type="button"
          variant="secondary"
        >
          Test connection
        </Button>
        <Button disabled={busy || empty} size="sm" type="submit">
          Add host
        </Button>
        {busy && <Spinner size="xs" />}
      </div>
      {(error ?? result) && (
        <p className={error || !result?.ok ? styles.error : styles.status}>
          {error ?? result?.message}
        </p>
      )}
    </form>
  );
}
