import type { RemoteAutomationGuardrails } from "@argus/remote-protocol";
import { FormField } from "../FormField/FormField";
import { Input } from "../Input/Input";
import { Toggle } from "../Toggle/Toggle";
import styles from "./AutomationFields.module.css";

function numberInput(value: string, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** The limits a run is held to, whatever its playbook says. */
export function GuardrailFields({
  disabled,
  guardrails,
  onChange,
}: {
  disabled?: boolean;
  guardrails: RemoteAutomationGuardrails;
  onChange: (guardrails: RemoteAutomationGuardrails) => void;
}) {
  const patch = (value: Partial<RemoteAutomationGuardrails>) =>
    onChange({ ...guardrails, ...value });

  return (
    <>
      <div className={styles.guardrails}>
        <FormField
          label="Confidence threshold"
          helper="Below this, a proposal waits for you."
        >
          <Input
            mono
            disabled={disabled}
            max={1}
            min={0}
            step={0.05}
            type="number"
            value={String(guardrails.confidence_threshold)}
            onChange={(e) =>
              patch({ confidence_threshold: numberInput(e.target.value, 0.8) })
            }
          />
        </FormField>
        <FormField label="Sessions at once" helper="Auto-started, in flight.">
          <Input
            mono
            disabled={disabled}
            min={0}
            type="number"
            value={String(guardrails.max_concurrent_sessions)}
            onChange={(e) =>
              patch({ max_concurrent_sessions: numberInput(e.target.value, 2) })
            }
          />
        </FormField>
        <FormField
          label="Files changed"
          helper="A bigger branch is never pushed."
        >
          <Input
            mono
            disabled={disabled}
            min={0}
            type="number"
            value={String(guardrails.max_files_changed)}
            onChange={(e) =>
              patch({ max_files_changed: numberInput(e.target.value, 25) })
            }
          />
        </FormField>
        <FormField
          label="Time limit (minutes)"
          helper="A run past this is stopped and marked failed."
        >
          <Input
            mono
            disabled={disabled}
            min={1}
            type="number"
            value={String(guardrails.max_run_minutes)}
            onChange={(e) =>
              patch({ max_run_minutes: numberInput(e.target.value, 20) })
            }
          />
        </FormField>
        <FormField
          label="Spend ceiling (USD)"
          helper={
            guardrails.max_cost_usd_per_run > 0
              ? "A run crossing this finishes its turn, then stops."
              : "Off — a run spends what the work costs."
          }
        >
          <Input
            mono
            disabled={disabled}
            min={0}
            step={1}
            type="number"
            value={String(guardrails.max_cost_usd_per_run)}
            onChange={(e) =>
              patch({ max_cost_usd_per_run: numberInput(e.target.value, 0) })
            }
          />
        </FormField>
      </div>

      <FormField
        label="Path denylist"
        helper="Comma-separated globs no automation branch may touch, e.g. infra/**, **/migrations/**."
      >
        <Input
          mono
          disabled={disabled}
          placeholder="infra/**, **/*.lock"
          value={guardrails.path_denylist.join(", ")}
          onChange={(e) =>
            patch({
              path_denylist: e.target.value
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean),
            })
          }
        />
      </FormField>

      <Toggle
        checked={guardrails.require_clean_ci}
        disabled={disabled}
        onChange={(checked) => patch({ require_clean_ci: checked })}
      >
        Require green CI before an auto-merge.
      </Toggle>
      <Toggle
        checked={guardrails.retry_other_accounts ?? true}
        disabled={disabled}
        onChange={(checked) => patch({ retry_other_accounts: checked })}
      >
        Retry on another Claude account when a usage limit is hit.
      </Toggle>
    </>
  );
}
