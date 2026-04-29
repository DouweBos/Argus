import { useEffect, useState } from "react";
import { getAppVersion, readArgusConfig } from "../lib/ipc";
import { isOlderThan } from "../lib/semver";

interface VersionCheck {
  appVersion: string;
  minVersion: string;
  outdated: boolean;
}

interface TrackedState extends VersionCheck {
  repoRoot: string | null;
}

const empty: VersionCheck = { appVersion: "", minVersion: "", outdated: false };

/**
 * Compares the running Argus app version against `min_argus_version` in the
 * project's `.argus.json`. Returns `outdated: true` only when both values are
 * known and the app is strictly older than the minimum. A failure on either
 * side is silent — we'd rather hide the warning than lie about it.
 */
export function useArgusVersionCheck(repoRoot: string | null): VersionCheck {
  const [tracked, setTracked] = useState<TrackedState>({
    ...empty,
    repoRoot,
  });

  if (tracked.repoRoot !== repoRoot) {
    setTracked({ ...empty, repoRoot });
  }

  useEffect(() => {
    if (!repoRoot) {
      return undefined;
    }
    let cancelled = false;
    Promise.all([getAppVersion(), readArgusConfig(repoRoot)])
      .then(([appVersion, config]) => {
        if (cancelled) {
          return;
        }
        const minVersion = config.min_argus_version ?? "";
        setTracked((prev) =>
          prev.repoRoot === repoRoot
            ? {
                repoRoot,
                appVersion,
                minVersion,
                outdated: minVersion
                  ? isOlderThan(appVersion, minVersion)
                  : false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTracked((prev) =>
          prev.repoRoot === repoRoot ? { ...empty, repoRoot } : prev,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  if (tracked.repoRoot !== repoRoot) {
    return empty;
  }

  return {
    appVersion: tracked.appVersion,
    minVersion: tracked.minVersion,
    outdated: tracked.outdated,
  };
}
