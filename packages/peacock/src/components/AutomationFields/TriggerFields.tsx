import {
  cronLabel,
  defaultOnceAt,
  draftScheduleError,
  formatTimestamp,
  localTimezone,
  nextFireTimes,
} from "@argus/client-core";
import type { RemoteAutomationDetail } from "@argus/remote-protocol";
import { useMemo } from "react";
import { CronSchedulePreview } from "../CronSchedulePreview/CronSchedulePreview";
import { FormField } from "../FormField/FormField";
import { Input } from "../Input/Input";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Toggle } from "../Toggle/Toggle";
import styles from "./AutomationFields.module.css";

const PREVIEW_COUNT = 5;

type TriggerDraft = Pick<
  RemoteAutomationDetail,
  "catch_up" | "cron" | "enabled" | "run_at" | "timezone" | "trigger_kind"
>;

/** When an automation fires: a cron, one date and time, or only by hand. */
export function TriggerFields({
  disabled,
  draft,
  onChange,
}: {
  disabled?: boolean;
  draft: TriggerDraft;
  onChange: (value: Partial<RemoteAutomationDetail>) => void;
}) {
  const timezone = draft.timezone || localTimezone();
  const scheduleError = draftScheduleError(draft);
  const previewTimes = useMemo(
    () =>
      draft.trigger_kind === "schedule" && !scheduleError
        ? nextFireTimes((draft.cron ?? "").trim(), timezone, PREVIEW_COUNT).map(
            formatTimestamp,
          )
        : [],
    [draft.trigger_kind, draft.cron, timezone, scheduleError],
  );

  const timezoneField = (
    <FormField label="Timezone">
      <Input
        mono
        disabled={disabled}
        placeholder={localTimezone()}
        value={draft.timezone ?? ""}
        onChange={(e) => onChange({ timezone: e.target.value })}
      />
    </FormField>
  );

  return (
    <>
      <SegmentedControl
        options={[
          { label: "Schedule", value: "schedule" as const },
          { label: "Once", value: "once" as const },
          { label: "Manual", value: "manual" as const },
        ]}
        value={draft.trigger_kind}
        onChange={(trigger_kind) =>
          onChange({
            trigger_kind,
            cron: draft.cron ?? "0 9 * * 1-5",
            run_at:
              trigger_kind === "once" && !draft.run_at
                ? defaultOnceAt(timezone)
                : draft.run_at,
            timezone,
          })
        }
      />
      {draft.trigger_kind === "manual" && (
        <p className={styles.caption}>
          Only runs when someone presses Run now.
        </p>
      )}
      {draft.trigger_kind === "once" && (
        <div className={styles.schedule}>
          <div className={styles.scheduleRow}>
            <FormField
              label="Run at"
              helper="Runs once, then pauses itself."
              error={scheduleError ?? undefined}
            >
              <Input
                disabled={disabled}
                type="datetime-local"
                value={draft.run_at ?? ""}
                onChange={(e) => onChange({ run_at: e.target.value })}
              />
            </FormField>
            {timezoneField}
          </div>
          <Toggle
            checked={draft.catch_up}
            disabled={disabled}
            onChange={(catch_up) => onChange({ catch_up })}
          >
            Still run if this computer was asleep at that time.
          </Toggle>
        </div>
      )}
      {draft.trigger_kind === "schedule" && (
        <div className={styles.schedule}>
          <div className={styles.scheduleRow}>
            <FormField
              label="Cron"
              helper={
                scheduleError
                  ? "Five fields: min hour dom mon dow."
                  : cronLabel((draft.cron ?? "").trim())
              }
              error={scheduleError ?? undefined}
            >
              <Input
                mono
                disabled={disabled}
                placeholder="0 9 * * 1-5"
                value={draft.cron ?? ""}
                onChange={(e) => onChange({ cron: e.target.value })}
              />
            </FormField>
            {timezoneField}
          </div>
          <CronSchedulePreview
            error={scheduleError}
            timezone={timezone}
            times={previewTimes}
          />
          <Toggle
            checked={draft.catch_up}
            disabled={disabled}
            onChange={(catch_up) => onChange({ catch_up })}
          >
            Catch up after the computer was asleep — fires once, never
            backfills.
          </Toggle>
        </div>
      )}
    </>
  );
}
