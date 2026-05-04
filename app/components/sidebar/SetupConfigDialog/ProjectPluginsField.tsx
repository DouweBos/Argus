/**
 * Project-level plugin disable list. Renders inside Project Settings →
 * Plugins. Checking a plugin here writes its id into
 * `.argus.json#plugins.disabled` — that masks the plugin off for everyone
 * working on this project, regardless of their personal user toggle. Useful
 * for repos that don't use device tooling (e.g. server-only projects).
 *
 * A project cannot force-enable a plugin the user has disabled; this is
 * mask-only by design.
 */

import type { PluginId } from "../../../plugins/types";
import {
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  Toggle,
} from "@argus/peacock";
import { PLUGINS } from "../../../plugins/registry";
import styles from "./ProjectPluginsField.module.css";

interface ProjectPluginsFieldProps {
  disabled: string[];
  onChange: (next: string[]) => void;
}

export function ProjectPluginsField({
  disabled,
  onChange,
}: ProjectPluginsFieldProps) {
  const visible = PLUGINS.filter((p) => !p.hidden);
  const set = new Set(disabled);

  const toggle = (id: PluginId, on: boolean) => {
    const next = new Set(set);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    onChange(Array.from(next));
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Disable plugins for everyone working on this project. Saved to .argus.json so the mask travels with the repo. Cannot force-enable plugins your team members have turned off."
        title="Disabled plugins"
      />
      <SettingsScreenDetailBody>
        <div className={styles.list}>
          {visible.map((plugin) => {
            const isDisabled = set.has(plugin.id);

            return (
              <div key={plugin.id} className={styles.row}>
                <div className={styles.text}>
                  <span className={styles.name}>{plugin.name}</span>
                  <span className={styles.description}>
                    {plugin.description}
                  </span>
                </div>
                <Toggle
                  checked={isDisabled}
                  onChange={(checked) => toggle(plugin.id, checked)}
                />
              </div>
            );
          })}
        </div>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
