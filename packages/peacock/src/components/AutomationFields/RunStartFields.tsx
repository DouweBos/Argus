import type { RemoteAutomationDetail } from "@argus/remote-protocol";
import { FormField } from "../FormField/FormField";
import { Input } from "../Input/Input";
import styles from "./AutomationFields.module.css";

const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * What happens before a run's agent starts: an optional precheck command that
 * must exit 0. Hidden on a computer too old to run one.
 */
export function RunStartFields({
  disabled,
  draft,
  onChange,
}: {
  disabled?: boolean;
  draft: RemoteAutomationDetail;
  onChange: (value: Partial<RemoteAutomationDetail>) => void;
}) {
  if (draft.precheck_command === undefined) {
    return null;
  }

  return (
    <section className={styles.group}>
      <h3 className={styles.heading}>Before each run</h3>
      <p className={styles.caption}>
        Runs in the first project in scope. Exit 0 starts the run; any other
        exit, or no answer in time, records it as skipped with the output.
      </p>
      <div className={styles.precheckRow}>
        <FormField label="Precheck command">
          <Input
            mono
            disabled={disabled}
            placeholder="./scripts/has-new-work.sh"
            value={draft.precheck_command}
            onChange={(e) => onChange({ precheck_command: e.target.value })}
          />
        </FormField>
        <FormField label="Timeout (seconds)">
          <Input
            mono
            disabled={disabled}
            min={1}
            type="number"
            value={String(
              draft.precheck_timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
            )}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              onChange({
                precheck_timeout_seconds:
                  Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_SECONDS,
              });
            }}
          />
        </FormField>
      </div>
    </section>
  );
}
