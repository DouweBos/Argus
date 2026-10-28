import type { AppSettings } from "../../../lib/types";
import { useEffect, useState } from "react";
import { SegmentedControl, SettingsScreenField, Toggle } from "@argus/peacock";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";

type Report = NonNullable<AppSettings["linear_report"]>;

const REPORT_OPTIONS = [
  { value: "off" as const, label: "Off" },
  { value: "pr" as const, label: "On pull request" },
  { value: "merge" as const, label: "On merge" },
];

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
    <>
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
      <SettingsScreenField
        label="Report back"
        caption="Comment on the issue with a short summary, the pull request and before/after simulator screenshots."
      >
        <SegmentedControl<Report>
          aria-label="When to report back to Linear"
          options={REPORT_OPTIONS}
          value={settings?.linear_report ?? "pr"}
          onChange={(next) => change({ linear_report: next })}
        />
      </SettingsScreenField>
    </>
  );
}
