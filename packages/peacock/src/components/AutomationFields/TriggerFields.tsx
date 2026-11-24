import {
  cronLabel,
  DEFAULT_SIGNAL_TRIGGER,
  DEFAULT_WEBHOOK_TRIGGER,
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
import { SignalTriggerFields } from "./SignalTriggerFields";
import { WebhookTriggerFields } from "./WebhookTriggerFields";

const PREVIEW_COUNT = 5;

type TriggerDraft = Pick<
  RemoteAutomationDetail,
  | "catch_up"
  | "cron"
  | "enabled"
  | "run_at"
  | "signal"
  | "slack_channel"
  | "slack_match"
  | "slack_text"
  | "timezone"
  | "trigger_kind"
  | "webhook"
>;

/** "Messages starting with “deploy failed” in #deploys". */
function slackTriggerLabel(draft: TriggerDraft): string {
  const where = draft.slack_channel ? ` in #${draft.slack_channel.name}` : "";
  const text = draft.slack_text?.trim();
  if (draft.slack_match === "prefix" && text) {
    return `Messages starting with “${text}”${where}`;
  }
  if (draft.slack_match === "keyword" && text) {
    return `Messages mentioning “${text}”${where}`;
  }

  return `Every message${where}`;
}

/** When an automation fires: a cron, one date and time, new signals, a Slack message, or only by hand. */
export function TriggerFields({
  disabled,
  draft,
  onChange,
  onRotateWebhookSecret,
}: {
  disabled?: boolean;
  draft: TriggerDraft;
  onChange: (value: Partial<RemoteAutomationDetail>) => void;
  onRotateWebhookSecret?: () => Promise<{ url: string | null; secret: string }>;
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

  // Picking a channel takes the bot's token, which only the Mac holds.
  if (draft.trigger_kind === "slack") {
    return (
      <p className={styles.caption}>
        {slackTriggerLabel(draft)}. Change the Slack trigger in Argus for Mac.
      </p>
    );
  }

  return (
    <>
      <SegmentedControl
        options={[
          { label: "Schedule", value: "schedule" as const },
          { label: "Once", value: "once" as const },
          { label: "Signal", value: "signal" as const },
          { label: "Webhook", value: "webhook" as const },
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
            signal: draft.signal ?? DEFAULT_SIGNAL_TRIGGER,
            webhook: draft.webhook ?? DEFAULT_WEBHOOK_TRIGGER,
            timezone,
          })
        }
      />
      {draft.trigger_kind === "manual" && (
        <p className={styles.caption}>
          Only runs when someone presses Run now.
        </p>
      )}
      {draft.trigger_kind === "signal" && (
        <SignalTriggerFields
          disabled={disabled}
          signal={draft.signal ?? DEFAULT_SIGNAL_TRIGGER}
          onChange={(signal) => onChange({ signal })}
        />
      )}
      {draft.trigger_kind === "webhook" && (
        <WebhookTriggerFields
          disabled={disabled}
          webhook={draft.webhook ?? DEFAULT_WEBHOOK_TRIGGER}
          onChange={(pacing) =>
            onChange({
              webhook: {
                ...(draft.webhook ?? DEFAULT_WEBHOOK_TRIGGER),
                ...pacing,
              },
            })
          }
          onRotateSecret={onRotateWebhookSecret}
        />
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
