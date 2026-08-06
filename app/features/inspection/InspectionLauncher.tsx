import type { InstalledApp } from "../../lib/ipc";
import { useMemo, useState } from "react";
import { Button, Icons, Spinner } from "@argus/peacock";
import styles from "./InspectionLauncher.module.css";
import { relaunchWithInspection } from "./store";

interface InspectionLauncherProps {
  deviceKey: string | null;
  foregroundApp: string | null;
  installedApps: InstalledApp[] | null;
  isSpringboard: boolean;
  launching: boolean;
}

/**
 * Shown when the app can't be inspected yet because it wasn't launched with the
 * in-process library. Two shapes: an app is running without injection (offer a
 * one-click restart), or nothing inspectable is foregrounded (offer a picker of
 * installed apps). Either path relaunches with `--inject` and then inspects.
 */
export function InspectionLauncher({
  deviceKey,
  foregroundApp,
  installedApps,
  isSpringboard,
  launching,
}: InspectionLauncherProps) {
  if (!isSpringboard && foregroundApp) {
    const name =
      installedApps?.find((a) => a.bundleId === foregroundApp)?.name ??
      foregroundApp;

    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.iconBadge}>
            <Icons.SearchIcon size={22} />
          </div>
          <div className={styles.title}>
            {name} is running without inspection
          </div>
          <div className={styles.hint}>
            Restart it with the inspection library injected to read its native
            view tree — real classes, colors, and fonts.
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={launching || !deviceKey}
            onClick={() => relaunchWithInspection(deviceKey, foregroundApp)}
          >
            {launching ? "Restarting…" : "Restart with inspection"}
          </Button>
          <div className={styles.bundle}>{foregroundApp}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.iconBadge}>
          <Icons.SearchIcon size={22} />
        </div>
        <div className={styles.title}>Pick an app to inspect</div>
        <div className={styles.hint}>
          Nothing is running to inspect. Launching an app here starts it with
          the inspection library injected.
        </div>
        <AppPicker
          deviceKey={deviceKey}
          apps={installedApps}
          launching={launching}
        />
      </div>
    </div>
  );
}

function AppPicker({
  deviceKey,
  apps,
  launching,
}: {
  apps: InstalledApp[] | null;
  deviceKey: string | null;
  launching: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!apps) {
      return null;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      return apps;
    }

    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.bundleId.toLowerCase().includes(q),
    );
  }, [apps, query]);

  if (apps === null) {
    return (
      <div className={styles.pickerStatus}>
        <Spinner size="sm" aria-label="Loading apps" />
        <span>Loading installed apps…</span>
      </div>
    );
  }
  if (apps.length === 0) {
    return (
      <div className={styles.pickerStatus}>No user apps are installed.</div>
    );
  }

  return (
    <div className={styles.picker}>
      {apps.length > 6 && (
        <input
          className={styles.search}
          type="text"
          placeholder="Filter apps…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className={styles.list}>
        {filtered?.map((app) => (
          <button
            key={app.bundleId}
            type="button"
            className={styles.appRow}
            disabled={launching || !deviceKey}
            onClick={() => relaunchWithInspection(deviceKey, app.bundleId)}
          >
            <span className={styles.appText}>
              <span className={styles.appName}>{app.name}</span>
              <span className={styles.appBundle}>{app.bundleId}</span>
            </span>
            <Icons.ChevronRightIcon size={14} />
          </button>
        ))}
      </div>
      {launching && (
        <div className={styles.pickerStatus}>
          <Spinner size="sm" aria-label="Launching" />
          <span>Launching with inspection…</span>
        </div>
      )}
    </div>
  );
}
