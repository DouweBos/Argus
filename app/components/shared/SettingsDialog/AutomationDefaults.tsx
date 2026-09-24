import type { AppSettings, AutonomyLevel } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Input, SegmentedControl, SettingsScreenField } from "@argus/peacock";
import {
  AUTONOMY_CAPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
} from "../../../lib/automations";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";
import { AutomationAllowlist } from "./AutomationAllowlist";

type AutonomyChoice = AutonomyLevel | "none";

const OPTIONS = [
  { label: "No cap", value: "none" as const },
  ...AUTONOMY_LEVELS.map((level) => ({
    label: AUTONOMY_LABELS[level],
    value: level,
  })),
];

const DEFAULTS = {
  max_concurrent_automation_sessions: 3,
  automation_daily_budget_usd: 0,
};

/**
 * The app-wide ceiling on what an automation may do. Host state, not renderer
 * state, so it follows whichever machine runs the clock.
 */
export function AutomationDefaults() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (loaded) => {
        if (!cancelled) {
          setSettings(loaded);
        }
      },
      () => {
        if (!cancelled) {
          setSettings({});
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const save = (patch: Partial<AppSettings>) => {
    const previous = settings ?? {};
    setSettings({ ...previous, ...patch });
    setAppSettings(patch).catch(() => setSettings(previous));
  };

  const autonomy: AutonomyChoice = settings?.default_autonomy ?? "none";
  const concurrency =
    settings?.max_concurrent_automation_sessions ??
    DEFAULTS.max_concurrent_automation_sessions;
  const budget =
    settings?.automation_daily_budget_usd ??
    DEFAULTS.automation_daily_budget_usd;

  return (
    <>
      <SettingsScreenField
        label="Default autonomy"
        caption={
          autonomy === "none"
            ? "Every automation runs at the level it sets for itself. A project can still cap it lower."
            : `${AUTONOMY_CAPTIONS[autonomy]} Caps every automation, and applies to those that don't set their own level. A project can cap it lower, never higher.`
        }
      >
        <SegmentedControl
          options={OPTIONS}
          value={autonomy}
          onChange={(value) =>
            save({ default_autonomy: value === "none" ? null : value })
          }
        />
      </SettingsScreenField>

      <SettingsScreenField
        label="Concurrent automation sessions"
        caption="How many sessions automations may have running at once, across all of them. Further proposals wait in the inbox."
      >
        <Input
          mono
          disabled={settings === null}
          min={1}
          type="number"
          value={String(concurrency)}
          onChange={(e) =>
            save({
              max_concurrent_automation_sessions: Math.max(
                1,
                Number(e.target.value) || 1,
              ),
            })
          }
        />
      </SettingsScreenField>

      <SettingsScreenField
        label="Daily automation budget"
        caption="Spend automations may reach in a day, in USD. 0 means no budget."
      >
        <Input
          mono
          disabled={settings === null}
          min={0}
          step={1}
          type="number"
          value={String(budget)}
          onChange={(e) =>
            save({
              automation_daily_budget_usd: Math.max(
                0,
                Number(e.target.value) || 0,
              ),
            })
          }
        />
      </SettingsScreenField>

      <AutomationAllowlist />
    </>
  );
}
