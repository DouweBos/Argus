import {
  AUTONOMY_CAPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  type AutonomyLevel,
  cronLabel,
  draftScheduleError,
  formatTimestamp,
  localTimezone,
  nextFireTimes,
} from "@argus/client-core";
import type {
  RemoteAutomationDetail,
  RemoteRunner,
  RemoteSignalSource,
} from "@argus/remote-protocol";
import { useMemo } from "react";
import { TerminalIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { CronSchedulePreview } from "../CronSchedulePreview/CronSchedulePreview";
import { FormField } from "../FormField/FormField";
import { Input, TextArea } from "../Input/Input";
import { MenuChip } from "../MenuChip/MenuChip";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Toggle } from "../Toggle/Toggle";
import { ToggleList, type ToggleListOption } from "../ToggleList/ToggleList";
import styles from "./AutomationFields.module.css";
import { GuardrailFields } from "./GuardrailFields";

const PREVIEW_COUNT = 5;

export interface AutomationFieldsProps {
  draft: RemoteAutomationDetail;
  onChange: (draft: RemoteAutomationDetail) => void;
  /** Projects the run may read; the caller adds any the draft names but the computer no longer lists. */
  projects: ToggleListOption[];
  sources: RemoteSignalSource[];
  /** Empty on a computer too old to say: the runner chip is hidden. */
  runners: RemoteRunner[];
  /** "Rewrite with Claude". Omit when this client may not spend. */
  onRevisePlaybook?: () => void;
  disabled?: boolean;
}

/**
 * Everything an automation is: what it does, when, what it may read, how far
 * it may go, and the playbook itself. Choices are picked in place — chips that
 * open menus, switches for lists — as ArgusUI's `AutomationFields` does.
 */
export function AutomationFields({
  disabled,
  draft,
  onChange,
  onRevisePlaybook,
  projects,
  runners,
  sources,
}: AutomationFieldsProps) {
  const patch = (value: Partial<RemoteAutomationDetail>) =>
    onChange({ ...draft, ...value });

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

  const runner = runners.find((r) => r.id === draft.runner);
  const declaredModels = runner?.models ?? [];

  return (
    <div className={styles.fields}>
      <section className={styles.group}>
        <h3 className={styles.heading}>Basics</h3>
        <FormField label="Name">
          <Input
            disabled={disabled}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </FormField>
        <FormField label="Description" helper="Shown in the automations list.">
          <Input
            disabled={disabled}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </FormField>
        <Toggle
          checked={draft.enabled}
          disabled={disabled}
          onChange={(enabled) => patch({ enabled })}
        >
          {draft.enabled ? "Enabled" : "Paused"}
        </Toggle>
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Trigger</h3>
        <SegmentedControl
          options={[
            { label: "Schedule", value: "schedule" as const },
            { label: "Manual", value: "manual" as const },
          ]}
          value={draft.trigger_kind}
          onChange={(trigger_kind) =>
            patch({
              trigger_kind,
              cron: draft.cron ?? "0 9 * * 1-5",
              timezone,
            })
          }
        />
        {draft.trigger_kind === "manual" ? (
          <p className={styles.caption}>
            Only runs when someone presses Run now.
          </p>
        ) : (
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
                  onChange={(e) => patch({ cron: e.target.value })}
                />
              </FormField>
              <FormField label="Timezone">
                <Input
                  mono
                  disabled={disabled}
                  placeholder={localTimezone()}
                  value={draft.timezone ?? ""}
                  onChange={(e) => patch({ timezone: e.target.value })}
                />
              </FormField>
            </div>
            <CronSchedulePreview
              error={scheduleError}
              timezone={timezone}
              times={previewTimes}
            />
            <Toggle
              checked={draft.catch_up}
              disabled={disabled}
              onChange={(catch_up) => patch({ catch_up })}
            >
              Catch up after the computer was asleep — fires once, never
              backfills.
            </Toggle>
          </div>
        )}
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Scope</h3>
        <p className={styles.caption}>
          Repos the run may read, and what feeds it work.
        </p>
        <span className={styles.subLabel}>Projects</span>
        <ToggleList
          disabled={disabled}
          emptyMessage="This computer has no projects registered."
          options={projects}
          selection={draft.repo_roots}
          onChange={(repo_roots) => patch({ repo_roots })}
        />
        <span className={styles.subLabel}>Signal sources</span>
        <ToggleList
          disabled={disabled}
          emptyMessage="This computer reported no signal sources."
          options={sources.map((s) => ({
            id: s.id,
            label: s.label,
            hint: s.available ? undefined : "not configured",
          }))}
          selection={draft.source_ids}
          onChange={(source_ids) => patch({ source_ids })}
        />
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Behaviour</h3>
        <p className={styles.caption}>
          {draft.autonomy
            ? AUTONOMY_CAPTIONS[draft.autonomy]
            : "Autonomy is a ceiling request — the computer takes the lowest of this, its own default and the project's cap."}
        </p>
        <div className={styles.chips}>
          <MenuChip
            showsTitle
            disabled={disabled}
            options={[
              {
                value: "",
                label: "Inherit",
                hint: "Use the computer's default",
              },
              ...AUTONOMY_LEVELS.map((level) => ({
                value: level,
                label: AUTONOMY_LABELS[level],
                hint: AUTONOMY_CAPTIONS[level],
              })),
            ]}
            title="Autonomy"
            value={draft.autonomy ?? ""}
            onChange={(value) =>
              patch({ autonomy: (value || null) as AutonomyLevel | null })
            }
          />
          {runners.length > 0 && (
            <MenuChip
              showsTitle
              disabled={disabled}
              leading={<TerminalIcon size={11} />}
              options={[
                {
                  value: "",
                  label: "Default",
                  hint: "Use the computer's default",
                },
                ...runners.map((r) => ({
                  value: r.id,
                  label: r.display_name,
                  hint: r.is_custom ? "Custom" : undefined,
                })),
              ]}
              title="Runner"
              value={draft.runner ?? ""}
              // Model ids don't carry across runners, so a switch drops the model.
              onChange={(id) =>
                id !== (draft.runner ?? "") &&
                patch({ runner: id || null, model: null })
              }
            />
          )}
          {declaredModels.length > 0 && (
            <MenuChip
              showsTitle
              disabled={disabled}
              options={[
                {
                  value: "",
                  label: "Default",
                  hint: "Use the runner's default",
                },
                ...declaredModels.map((m) => ({
                  value: m.value,
                  label: m.display_name,
                  hint: m.description ?? undefined,
                })),
              ]}
              title="Model"
              value={draft.model ?? ""}
              onChange={(model) => patch({ model: model || null })}
            />
          )}
        </div>
        {/* Claude Code only learns its models from a live handshake, so there it stays free text. */}
        {declaredModels.length === 0 && (
          <Input
            mono
            disabled={disabled}
            placeholder="Model — blank uses the default"
            value={draft.model ?? ""}
            onChange={(e) => patch({ model: e.target.value || null })}
          />
        )}
        <GuardrailFields
          disabled={disabled}
          guardrails={draft.guardrails}
          onChange={(guardrails) => patch({ guardrails })}
        />
      </section>

      <section className={styles.group}>
        <div className={styles.headingRow}>
          <h3 className={styles.heading}>Playbook</h3>
          {onRevisePlaybook && (
            <Button
              disabled={disabled || draft.playbook.trim().length === 0}
              size="sm"
              variant="secondary"
              onClick={onRevisePlaybook}
            >
              Rewrite with Claude
            </Button>
          )}
        </div>
        <p className={styles.caption}>
          Markdown instructions handed to the run's agent.
        </p>
        <TextArea
          mono
          className={styles.playbook}
          disabled={disabled}
          placeholder="What should this run do?"
          value={draft.playbook}
          onChange={(e) => patch({ playbook: e.target.value })}
        />
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Extra instructions</h3>
        <p className={styles.caption}>
          Added after the playbook on every run; they win where the two
          disagree.
        </p>
        <TextArea
          mono
          className={styles.extra}
          disabled={disabled}
          placeholder="Skip anything labelled needs-design."
          value={draft.extra_instructions}
          onChange={(e) => patch({ extra_instructions: e.target.value })}
        />
      </section>
    </div>
  );
}
