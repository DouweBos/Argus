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
  const [automationBaseDir, setAutomationBaseDir] = useState<string | null>(
    null,
  );
  const [defaultPath, setDefaultPath] = useState("");

  useEffect(() => {
    getAppSettings()
      .then((settings) => {
        setBaseDir(settings.worktrees_base_dir ?? "");
        setAutomationBaseDir(settings.automation_worktrees_base_dir ?? "");
      })
      .catch(() => {
        setBaseDir("");
        setAutomationBaseDir("");
      });
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
        {automationBaseDir !== null && (
          <WorktreeLocationField
            label="Automation worktree location"
            caption="Where automations create their worktrees. They open far more than anyone merges, so a roomier drive keeps a busy automation from filling up your boot disk. Leave it empty to use the location above."
            defaultPath={baseDir?.trim() || defaultPath}
            purpose="automation"
            value={automationBaseDir}
            onCommit={async (next) => {
              await setAppSettings({ automation_worktrees_base_dir: next });
              setAutomationBaseDir(next);
            }}
          />
        )}
        <Banner tone="info">
          A project can override either of these from its own settings. That
          override is personal — it is never written into the repository.
        </Banner>
        <Banner tone="info">
          If the automation drive isn&apos;t connected, scheduled runs skip that
          project instead of falling back to your boot disk.
        </Banner>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
