import { FormField } from "../FormField/FormField";
import { Input } from "../Input/Input";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import styles from "./AutomationFields.module.css";

export interface Pacing {
  fire: "batch" | "each";
  max_runs_per_hour: number;
}

/** How an event trigger turns events into runs: one each or batched, and how many an hour. */
export function PacingFields({
  disabled,
  pacing,
  onChange,
}: {
  disabled?: boolean;
  pacing: Pacing;
  onChange: (pacing: Pacing) => void;
}) {
  return (
    <div className={styles.scheduleRow}>
      <FormField label="Runs">
        <SegmentedControl
          options={[
            { label: "One per event", value: "each" as const },
            { label: "One for everything new", value: "batch" as const },
          ]}
          value={pacing.fire}
          onChange={(fire) => onChange({ ...pacing, fire })}
        />
      </FormField>
      <FormField label="At most, per hour">
        <Input
          disabled={disabled}
          type="number"
          min={1}
          max={60}
          value={String(pacing.max_runs_per_hour)}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            onChange({
              ...pacing,
              max_runs_per_hour: Number.isFinite(n)
                ? Math.min(60, Math.max(1, n))
                : 4,
            });
          }}
        />
      </FormField>
    </div>
  );
}
