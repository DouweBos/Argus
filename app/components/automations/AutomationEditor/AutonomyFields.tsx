import type { AutomationGuardrails, AutonomyLevel } from "../../../lib/types";
import { FormField, Input, SegmentedControl, Toggle } from "@argus/peacock";
import {
  AUTONOMY_CAPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
} from "../../../lib/automations";
import styles from "./AutomationEditor.module.css";

export type AutonomyChoice = AutonomyLevel | "inherit";

const OPTIONS = [
  { label: "Inherit", value: "inherit" as const },
  ...AUTONOMY_LEVELS.map((level) => ({
    label: AUTONOMY_LABELS[level],
    value: level,
  })),
];

function numberInput(value: string, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The ladder and its limits. What you pick here is a ceiling request, not a
 * guarantee: the host takes the lowest of this, the app default and the
 * project's own ceiling.
 */
export function AutonomyFields({
  autonomy,
  guardrails,
  onAutonomyChange,
  onGuardrailsChange,
}: {
  autonomy: AutonomyChoice;
  guardrails: AutomationGuardrails;
  onAutonomyChange: (value: AutonomyChoice) => void;
  onGuardrailsChange: (value: AutomationGuardrails) => void;
}) {
  const patch = (value: Partial<AutomationGuardrails>) =>
    onGuardrailsChange({ ...guardrails, ...value });

  return (
    <>
      <FormField
        label="Autonomy"
        helper={
          autonomy === "inherit"
            ? "Uses the app-wide default from Settings. A project can cap it lower, never higher."
            : AUTONOMY_CAPTIONS[autonomy]
        }
      >
        <SegmentedControl
          options={OPTIONS}
          value={autonomy}
          onChange={onAutonomyChange}
        />
      </FormField>

      <div className={styles.guardrails}>
        <FormField
          label="Confidence threshold"
          helper="Below this, a proposal waits for you."
        >
          <Input
            mono
            max={1}
            min={0}
            step={0.05}
            type="number"
            value={String(guardrails.confidence_threshold)}
            onChange={(e) =>
              patch({
                confidence_threshold: numberInput(e.target.value, 0.8),
              })
            }
          />
        </FormField>

        <FormField label="Sessions at once" helper="Auto-started, in flight.">
          <Input
            mono
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
            min={0}
            type="number"
            value={String(guardrails.max_files_changed)}
            onChange={(e) =>
              patch({ max_files_changed: numberInput(e.target.value, 25) })
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

      <label className={styles.catchUp}>
        <Toggle
          checked={guardrails.require_clean_ci}
          onChange={(checked) => patch({ require_clean_ci: checked })}
        />
        <span>Require green CI before an auto-merge.</span>
      </label>
    </>
  );
}
