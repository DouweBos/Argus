/**
 * Project-level automation limits. Renders inside Project Settings →
 * Automations and writes `.argus.json#automations`, so the ceiling travels
 * with the repo.
 *
 * The ceiling only ever caps: the host takes the lowest of the app default,
 * the automation's own level and this. A repo cannot hand an automation more
 * autonomy than the machine allows.
 */

import type {
  AutonomyLevel,
  ProjectAutomationConfig,
} from "../../../lib/types";
import {
  Input,
  SegmentedControl,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
} from "@argus/peacock";
import {
  AUTONOMY_CAPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
} from "../../../lib/automations";

type Ceiling = AutonomyLevel | "unset";

const OPTIONS = [
  { label: "No ceiling", value: "unset" as const },
  ...AUTONOMY_LEVELS.map((level) => ({
    label: AUTONOMY_LABELS[level],
    value: level,
  })),
];

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ProjectAutomationsField({
  value,
  onChange,
}: {
  onChange: (next: ProjectAutomationConfig) => void;
  value: ProjectAutomationConfig;
}) {
  const ceiling: Ceiling = value.autonomy_ceiling ?? "unset";

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="How far Argus automations may go in this repository. Saved to .argus.json and shared with the team. These limits only ever tighten what the app allows."
        title="Automations"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Autonomy ceiling"
          caption={
            ceiling === "unset"
              ? "No repo-level cap — automations run at whatever the app and their own setting allow."
              : `Highest rung any automation reaches here. ${AUTONOMY_CAPTIONS[ceiling]}`
          }
        >
          <SegmentedControl
            options={OPTIONS}
            value={ceiling}
            onChange={(next) =>
              onChange({
                ...value,
                autonomy_ceiling: next === "unset" ? undefined : next,
              })
            }
          />
        </SettingsScreenField>

        <SettingsScreenField
          label="Path denylist"
          caption="Comma-separated globs no automation-started branch may touch. Added to each automation's own list."
        >
          <Input
            mono
            placeholder="infra/**, **/migrations/**"
            value={(value.path_denylist ?? []).join(", ")}
            onChange={(e) =>
              onChange({ ...value, path_denylist: parseList(e.target.value) })
            }
          />
        </SettingsScreenField>

        <SettingsScreenField
          label="Disabled automations"
          caption="Comma-separated automation ids or template ids this repo opts out of entirely, e.g. regression-sweep."
        >
          <Input
            mono
            placeholder="regression-sweep, take-the-easy-ones"
            value={(value.disabled ?? []).join(", ")}
            onChange={(e) =>
              onChange({ ...value, disabled: parseList(e.target.value) })
            }
          />
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
