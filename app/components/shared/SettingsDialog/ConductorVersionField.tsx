/**
 * Settings → Tools → Conductor version. Lets the user pin a conductor version
 * that Argus installs into `~/.argus/conductor/<version>/` at runtime — no app
 * update required. Blank reverts to the version bundled with the app.
 *
 * Main owns provisioning; this just reads status, pushes a version, and
 * reflects install progress pushed back over `conductor_status_changed`.
 */

import type { ConductorStatus } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Button, Input, SettingsScreenField, Spinner } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  getConductorStatusIpc,
  setConductorVersionIpc,
} from "../../../lib/ipc";
import styles from "./ConductorVersionField.module.css";

const STATUS_EVENT = "conductor_status_changed";

export function ConductorVersionField() {
  const [status, setStatus] = useState<ConductorStatus | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let active = true;
    getConductorStatusIpc().then((s) => {
      if (active) {
        setStatus(s);
        setDraft(s.overrideVersion ?? "");
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useIpcEvent<ConductorStatus>(STATUS_EVENT, (s) => setStatus(s));

  const installing = status?.state === "installing";
  const pinned = status?.overrideVersion ?? "";
  const dirty = draft.trim() !== pinned;

  const apply = () => {
    if (installing) {
      return;
    }
    setConductorVersionIpc(draft.trim() || null).then(setStatus);
  };

  const reset = () => {
    setDraft("");
    setConductorVersionIpc(null).then((s) => {
      setStatus(s);
    });
  };

  return (
    <SettingsScreenField
      caption="Pin the conductor CLI version agents use. Installed on demand from npm into ~/.argus — no app update needed. Leave blank to use the version bundled with Argus."
      label="Conductor version"
    >
      <div className={styles.row}>
        <Input
          disabled={installing}
          mono
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              apply();
            }
          }}
          placeholder={status?.bundledVersion ?? "0.0.0"}
          value={draft}
        />
        <Button
          disabled={!dirty || installing}
          onClick={apply}
          variant="secondary"
        >
          {installing ? "Installing…" : "Apply"}
        </Button>
        {pinned && !installing && (
          <Button onClick={reset} variant="ghost">
            Use bundled
          </Button>
        )}
      </div>
      <StatusLine status={status} />
    </SettingsScreenField>
  );
}

function StatusLine({ status }: { status: ConductorStatus | null }) {
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
