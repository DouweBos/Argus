/**
 * Settings → Plugins section. Lists every plugin grouped by `PluginGroup`,
 * shows the user toggle, surfaces dependency hints when a plugin is forced
 * off because a base is disabled, and runs the plugin's prereqs live with
 * Fix actions inline. Same `PrereqList` component the onboarding Preflight
 * step uses, so a missing checks Settings flow stays in sync.
 */

import type {
  PluginGroup,
  PluginId,
  PluginManifest,
} from "../../../plugins/types";
import { useMemo, useState } from "react";
import {
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  Toggle,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  clearPluginAssets,
  downloadPluginAssets,
  type PluginDownloadProgress,
} from "../../../lib/ipc";
import { PLUGINS } from "../../../plugins/registry";
import {
  setPluginEnabled,
  useEffectivePluginEnabled,
  usePluginEnabled,
  useProjectDisabled,
} from "../../../plugins/store";
import { PrereqList } from "../PrereqList";
import styles from "./PluginsSection.module.css";

const GROUP_ORDER: PluginGroup[] = ["Device", "Agent", "Git", "Misc"];

export function PluginsSection() {
  const groups = useMemo(() => {
    const byGroup = new Map<PluginGroup, PluginManifest[]>();
    for (const plugin of PLUGINS) {
      if (plugin.hidden) {
        continue;
      }
      const existing = byGroup.get(plugin.group) ?? [];
      existing.push(plugin);
      byGroup.set(plugin.group, existing);
    }

    return GROUP_ORDER.flatMap((group) => {
      const list = byGroup.get(group);
      if (!list || list.length === 0) {
        return [];
      }

      return [{ group, plugins: list }];
    });
  }, []);

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Pick the tools you want bundled into Argus. Disable anything you don't use to keep the app lean — plugin assets only download when you turn one on."
        title="Plugins"
      />
      <SettingsScreenDetailBody>
        {groups.map(({ group, plugins }) => (
          <SettingsScreenField key={group} label={group}>
            <div className={styles.list}>
              {plugins.map((plugin) => (
                <PluginRow key={plugin.id} plugin={plugin} />
              ))}
            </div>
          </SettingsScreenField>
        ))}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

interface PluginRowProps {
  plugin: PluginManifest;
}

function PluginRow({ plugin }: PluginRowProps) {
  const userEnabled = usePluginEnabled(plugin.id);
  const effective = useEffectivePluginEnabled(plugin.id);
  const projectDisabled = useProjectDisabled();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<PluginDownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useIpcEvent<PluginDownloadProgress>("plugin:download", (p) => {
    if ((p.pluginId as PluginId) === plugin.id) {
      setProgress(p);
    }
  });

  const handleToggle = async (checked: boolean) => {
    setDownloadError(null);
    if (checked) {
      // Trigger asset download first; only flip the user-toggle if it succeeds
      // so the user doesn't end up with "enabled but no assets" state.
      setDownloading(true);
      try {
        await downloadPluginAssets(plugin.id);
        setPluginEnabled(plugin.id, true);
      } catch (err) {
        setDownloadError(
          err instanceof Error ? err.message : "Download failed",
        );
      } finally {
        setDownloading(false);
        setProgress(null);
      }
    } else {
      setPluginEnabled(plugin.id, false);
      // Best-effort: drop the cached assets. A re-enable re-fetches.
      clearPluginAssets(plugin.id).catch(() => {});
    }
  };

  const projectMasked = projectDisabled.includes(plugin.id);
  const blockedByDep = userEnabled && !effective && !projectMasked;
  const missingDeps = blockedByDep
    ? (plugin.requires ?? []).filter(
        (dep) => !PLUGINS.find((p) => p.id === dep)?.defaultEnabled,
      )
    : [];

  const status = (() => {
    if (downloading) {
      const pct =
        progress && progress.bytesTotal
          ? Math.round((progress.bytesDownloaded / progress.bytesTotal) * 100)
          : null;

      return `Downloading ${progress?.assetName ?? "assets"}…${
        pct !== null ? ` ${pct}%` : ""
      }`;
    }
    if (downloadError) {
      return `Download failed: ${downloadError}`;
    }
    if (projectMasked) {
      return "Disabled by this project";
    }
    if (blockedByDep && missingDeps.length > 0) {
      return `Needs: ${missingDeps.join(", ")}`;
    }

    return null;
  })();

  // Render the live prereq list once the plugin has been turned on. Hidden
  // when the toggle is off — there's no point running checks for tooling
  // the user doesn't need.
  const showPrereqs =
    userEnabled &&
    !projectMasked &&
    plugin.prereqs &&
    plugin.prereqs.length > 0;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <div className={styles.text}>
          <span className={styles.name}>{plugin.name}</span>
          <span className={styles.description}>{plugin.description}</span>
          {status && <span className={styles.status}>{status}</span>}
        </div>
        <Toggle
          checked={userEnabled}
          disabled={projectMasked || downloading}
          onChange={handleToggle}
        />
      </div>
      {showPrereqs && (
        <div className={styles.prereqs}>
          <PrereqList ids={plugin.prereqs ?? []} />
        </div>
      )}
    </div>
  );
}
