import { SIGNAL_EVENT_LABELS, SIGNAL_EVENT_ORDER } from "@argus/client-core";
import type {
  RemoteSignalEventKind,
  RemoteSignalTrigger,
} from "@argus/remote-protocol";
import { FormField } from "../FormField/FormField";
import { Input } from "../Input/Input";
import { ToggleList } from "../ToggleList/ToggleList";
import styles from "./AutomationFields.module.css";
import { PacingFields } from "./PacingFields";

const HINTS: Partial<Record<RemoteSignalEventKind, string>> = {
  new_issue: "In this automation's projects",
  new_pr: "In this automation's projects",
  ci_failed: "On a pull request you opened",
};

/** What a signal trigger reacts to, an optional label filter, and its pacing. */
export function SignalTriggerFields({
  disabled,
  signal,
  onChange,
}: {
  disabled?: boolean;
  signal: RemoteSignalTrigger;
  onChange: (signal: RemoteSignalTrigger) => void;
}) {
  return (
    <div className={styles.schedule}>
      <p className={styles.caption}>
        Checks GitHub, GitLab and Linear every two minutes and runs when one of
        these happens. Linear only reports new and assigned issues, and only
        while it is connected on this computer.
      </p>
      <FormField
        label="Run when"
        error={signal.on.length === 0 ? "Pick at least one event." : undefined}
      >
        <ToggleList
          disabled={disabled}
          emptyMessage=""
          options={SIGNAL_EVENT_ORDER.map((id) => ({
            id,
            label: SIGNAL_EVENT_LABELS[id],
            hint: HINTS[id],
          }))}
          selection={signal.on}
          onChange={(on) =>
            onChange({
              ...signal,
              on: SIGNAL_EVENT_ORDER.filter((k) => on.includes(k)),
            })
          }
        />
      </FormField>
      <FormField
        label="Only with labels"
        helper="Any of these. Leave empty for every item."
      >
        <Input
          mono
          disabled={disabled}
          placeholder="bug, needs-triage"
          value={signal.labels.join(", ")}
          onChange={(e) =>
            onChange({
              ...signal,
              labels: e.target.value
                .split(",")
                .map((l) => l.trim())
                .filter(Boolean),
            })
          }
        />
      </FormField>
      <PacingFields
        disabled={disabled}
        pacing={signal}
        onChange={(pacing) => onChange({ ...signal, ...pacing })}
      />
    </div>
  );
}
