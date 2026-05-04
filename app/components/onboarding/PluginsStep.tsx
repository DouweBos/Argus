/**
 * Onboarding step 3: pick plugins. Lands between permissions and preflight so
 * the prereq filter at preflight time only checks the plugins the user
 * actually wants. Skipping is fine — every plugin can be enabled later from
 * Settings → Plugins.
 */

import type { PluginManifest } from "../../plugins/types";
import { useState } from "react";
import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { clearPluginAssets, downloadPluginAssets } from "../../lib/ipc";
import { PLUGINS } from "../../plugins/registry";
import {
  getUserEnabled,
  setPluginEnabled,
  usePluginEnabled,
} from "../../plugins/store";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./PluginsStep.module.css";

export function PluginsStep() {
  const { advance, skipStep } = useOnboarding();
  const [downloading, setDownloading] = useState(false);

  const visible = PLUGINS.filter((p) => !p.hidden);

  const handleContinue = async () => {
    setDownloading(true);
    try {
      const enabled = visible.filter((p) => getUserEnabled(p.id));
      await Promise.allSettled(enabled.map((p) => downloadPluginAssets(p.id)));
    } finally {
      setDownloading(false);
      await advance("preflight");
    }
  };

  return (
    <OnboardingLayout
      currentStep="plugins"
      title="Pick the tools you'll use"
      subtitle="Argus ships these as opt-in plugins so the install stays small. Turn on what you need now — you can always change this later in Settings → Plugins."
      footerLeft={
        <Button
          variant="ghost"
          onClick={() => skipStep("plugins", "preflight")}
        >
          Skip for now
        </Button>
      }
      footerRight={
        <Button onClick={handleContinue} disabled={downloading}>
          {downloading ? "Downloading…" : "Continue"}
        </Button>
      }
    >
      <div className={styles.list}>
        {visible.map((plugin) => (
          <PluginPickerRow key={plugin.id} plugin={plugin} />
        ))}
      </div>
    </OnboardingLayout>
  );
}

interface PluginPickerRowProps {
  plugin: PluginManifest;
}

function PluginPickerRow({ plugin }: PluginPickerRowProps) {
  const enabled = usePluginEnabled(plugin.id);

  const handleChange = (checked: boolean) => {
    setPluginEnabled(plugin.id, checked);
    if (!checked) {
      clearPluginAssets(plugin.id).catch(() => {});
    }
  };

  return (
    <label className={styles.row}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={enabled}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <div className={styles.text}>
        <span className={styles.name}>{plugin.name}</span>
        <span className={styles.description}>{plugin.description}</span>
        {plugin.prereqs && plugin.prereqs.length > 0 && (
          <span className={styles.prereqs}>
            Needs: {plugin.prereqs.join(", ")}
          </span>
        )}
      </div>
    </label>
  );
}
