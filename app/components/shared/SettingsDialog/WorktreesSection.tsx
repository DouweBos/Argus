/**
 * Settings → Worktrees. Where Argus creates the working copies for sessions,
 * for every project that doesn't set its own location.
 */

import { useEffect, useState } from "react";
import {
  Banner,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
} from "@argus/peacock";
import {
  getAppSettings,
  getWorktreesDefaultBase,
  setAppSettings,
} from "../../../lib/ipc";
import { WorktreeLocationField } from "../WorktreeLocationField";

export function WorktreesSection() {
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [defaultPath, setDefaultPath] = useState("");

  useEffect(() => {
    getAppSettings()
      .then((settings) => setBaseDir(settings.worktrees_base_dir ?? ""))
      .catch(() => setBaseDir(""));
    getWorktreesDefaultBase()
      .then(setDefaultPath)
      .catch(() => undefined);
  }, []);

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        title="Worktrees"
        description="Where Argus creates the working copy for each session. Point this at an external drive to keep large checkouts off your boot disk."
      />
      <SettingsScreenDetailBody>
        {baseDir !== null && (
          <WorktreeLocationField
            defaultPath={defaultPath}
            value={baseDir}
            onCommit={async (next) => {
              await setAppSettings({ worktrees_base_dir: next });
              setBaseDir(next);
            }}
          />
        )}
        <Banner tone="info">
          A project can override this from its own settings. That override is
          personal — it is never written into the repository.
        </Banner>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
