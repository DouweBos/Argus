/**
 * Settings → Tools → Conductor version. Lets the user pin a conductor version
 * that Argus installs into `~/.argus/conductor/<version>/` at runtime — no app
 * update required. The picker lists npm releases at or above the bundled one;
 * "bundled" reverts to the version shipped with the app.
 *
 * Main owns provisioning; this just reads status, pushes a version, and
 * reflects install progress pushed back over `conductor_status_changed`.
 */

import type { ConductorStatus } from "../../../lib/types";
import { useEffect, useState } from "react";
import { SettingsScreenField, Select, Spinner } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  getConductorStatusIpc,
  listConductorVersionsIpc,
  setConductorVersionIpc,
} from "../../../lib/ipc";
import styles from "./ConductorVersionField.module.css";

const STATUS_EVENT = "conductor_status_changed";

export function ConductorVersionField() {
  const [status, setStatus] = useState<ConductorStatus | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getConductorStatusIpc().then((s) => {
      if (active) {
        setStatus(s);
      }
    });
    listConductorVersionsIpc().then(
      (v) => {
        if (active) {
          setVersions(v);
        }
      },
      (e: unknown) => {
        if (active) {
          setListError(typeof e === "string" ? e : String(e));
        }
      },
    );

    return () => {
      active = false;
    };
  }, []);

  useIpcEvent<ConductorStatus>(STATUS_EVENT, (s) => setStatus(s));

  const installing = status?.state === "installing";
  const pinned = status?.overrideVersion ?? "";
  // A pinned version that predates this build won't be in the fetched list —
  // keep it selectable so the dropdown still reflects reality.
  const options =
    pinned && !versions.includes(pinned) ? [pinned, ...versions] : versions;

  const select = (version: string) => {
    setConductorVersionIpc(version || null).then(setStatus);
  };

  return (
    <SettingsScreenField
      caption="Pin the conductor CLI version agents use. Installed on demand from npm into ~/.argus — no app update needed. Only versions at or above the bundled one are listed."
      label="Conductor version"
    >
      <div className={styles.row}>
        <Select
          disabled={installing || (options.length === 0 && !pinned)}
          mono
          onChange={(e) => select(e.target.value)}
          value={pinned}
        >
          <option value="">
            Bundled{status?.bundledVersion ? ` (${status.bundledVersion})` : ""}
          </option>
          {options.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <StatusLine listError={listError} status={status} />
    </SettingsScreenField>
  );
}

function StatusLine({
  listError,
  status,
}: {
  listError: string | null;
  status: ConductorStatus | null;
}) {
  if (!status) {
    return null;
  }
  if (status.state === "installing") {
    return (
      <p className={styles.status}>
        <Spinner size="xs" /> Installing conductor v{status.overrideVersion}…
      </p>
    );
  }
  if (status.state === "error") {
    return (
      <p className={`${styles.status} ${styles.error}`}>
        {status.error ?? "Install failed."} Using bundled v
        {status.bundledVersion}.
      </p>
    );
  }
  if (listError) {
    return <p className={`${styles.status} ${styles.error}`}>{listError}</p>;
  }
  if (status.overrideVersion && status.state === "ready") {
    return (
      <p className={styles.status}>
        Using pinned conductor v{status.activeVersion}.
      </p>
    );
  }

  return (
    <p className={styles.status}>
      Using bundled conductor v{status.bundledVersion ?? "unknown"}.
    </p>
  );
}
