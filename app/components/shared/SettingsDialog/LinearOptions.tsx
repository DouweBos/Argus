import type { AppSettings } from "../../../lib/types";
import { useEffect, useState } from "react";
import { SettingsScreenField, Toggle } from "@argus/peacock";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";

/** What Argus does to an issue a session was started from. */
export function LinearOptions() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (loaded) => !cancelled && setSettings(loaded),
      () => {},
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const change = (patch: Partial<AppSettings>) => {
    const previous = settings;
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setAppSettings(patch).catch(() => setSettings(previous));
  };

  return (
    <SettingsScreenField
        label="Move to In Progress"
        caption="When an agent starts from an issue, move the issue to its team's first started state."
      >
        <Toggle
          checked={settings?.linear_mark_started !== false}
          disabled={!settings}
          onChange={(next) => change({ linear_mark_started: next })}
        >
          Move issues when work starts
        </Toggle>
      </SettingsScreenField>
  );
}
