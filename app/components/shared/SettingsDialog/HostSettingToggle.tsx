import type { AppSettings } from "../../../lib/types";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SettingsScreenField, Toggle } from "@argus/peacock";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";

type DefaultOnSetting = "conductor_guide" | "follow_up_suggestions";

interface HostSettingToggleProps {
  caption: string;
  children: ReactNode;
  label: string;
  setting: DefaultOnSetting;
}

/**
 * A default-on boolean in the host's app settings. Host state rather than
 * renderer state: the host makes the call, and every client shows the result.
 */
export function HostSettingToggle({
  setting,
  label,
  caption,
  children,
}: HostSettingToggleProps) {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (settings) => {
        if (!cancelled) {
          setEnabled(settings[setting] !== false);
          setLoaded(true);
        }
      },
      () => {
        if (!cancelled) {
          setLoaded(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [setting]);

  const change = (next: boolean) => {
    setEnabled(next);
    const patch: AppSettings = { [setting]: next };
    setAppSettings(patch).catch(() => {
      setEnabled(!next);
    });
  };

  return (
    <SettingsScreenField label={label} caption={caption}>
      <Toggle checked={enabled} disabled={!loaded} onChange={change}>
        {children}
      </Toggle>
    </SettingsScreenField>
  );
}
