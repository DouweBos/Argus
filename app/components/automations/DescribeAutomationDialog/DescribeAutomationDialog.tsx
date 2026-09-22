import type {
  AutomationDraft,
  AutomationTrigger,
  CreateAutomationInput,
} from "../../../lib/types";
import { useMemo, useState } from "react";
import {
  Banner,
  Button,
  CronSchedulePreview,
  Dialog,
  DialogBody,
  DialogFooter,
  FormField,
  Input,
  SegmentedControl,
  Spinner,
  TextArea,
} from "@argus/peacock";
import {
  cronError,
  formatTimestamp,
  localTimezone,
  nextFireTimes,
} from "../../../lib/automations";
import { draftAutomation } from "../../../lib/ipc";
import {
  createAutomation,
  openAutomation,
} from "../../../stores/automationStore";
import styles from "./DescribeAutomationDialog.module.css";

const PREVIEW_COUNT = 5;
const TITLE_ID = "describe-automation-title";

const PLACEHOLDER =
  "Every weekday at 8am, look at my open PRs and tell me which ones have gone stale.";

interface Fields {
  catchUp: boolean;
  cron: string;
  description: string;
  kind: AutomationTrigger["kind"];
  name: string;
  playbook: string;
  timezone: string;
}

function toFields(input: CreateAutomationInput): Fields {
  const schedule = input.trigger.kind === "schedule" ? input.trigger : null;

  return {
    name: input.name,
    description: input.description ?? "",
    playbook: input.playbook,
    kind: input.trigger.kind,
    cron: schedule?.cron ?? "0 9 * * 1-5",
    timezone: schedule?.timezone ?? localTimezone(),
    catchUp: schedule?.catch_up ?? true,
  };
}

function toTrigger(fields: Fields): AutomationTrigger {
  return fields.kind === "schedule"
    ? {
        kind: "schedule",
        cron: fields.cron.trim(),
        timezone: fields.timezone.trim() || localTimezone(),
        catch_up: fields.catchUp,
      }
    : { kind: "manual" };
}

/**
 * "Describe it" — a sentence in, a reviewable automation out.
 *
 * The draft is never saved on the user's behalf: Claude fills the fields, the
 * user reads the playbook and the next fire times, and only then does anything
 * reach the host — disabled, like every built-in template.
 */
export function DescribeAutomationDialog({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);

  const scheduleError =
    fields?.kind === "schedule"
      ? cronError(fields.cron, fields.timezone)
      : null;
  const previewTimes = useMemo(
    () =>
      fields?.kind === "schedule" && !scheduleError
        ? nextFireTimes(fields.cron, fields.timezone, PREVIEW_COUNT).map((t) =>
            formatTimestamp(t),
          )
        : [],
    [fields?.kind, fields?.cron, fields?.timezone, scheduleError],
  );

  const patch = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => (f ? { ...f, [key]: value } : f));

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await draftAutomation(description, localTimezone());
      setDraft(result);
      setFields(toFields(result.input));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!draft || !fields) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const automation = await createAutomation({
        ...draft.input,
        name: fields.name.trim() || "New automation",
        description: fields.description.trim(),
        playbook: fields.playbook,
        trigger: toTrigger(fields),
        // A generated automation is never live on arrival.
        enabled: false,
        autonomy: null,
      });
      onClose();
      openAutomation(automation.id);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setSaving(false);
    }
  };

  const scopeCount = draft?.input.scope?.repo_roots.length ?? 0;
  const sourceCount = draft?.input.source_ids?.length ?? 0;

  return (
    <Dialog
      title="Describe an automation"
      titleId={TITLE_ID}
      size="medium"
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          label="What should it do?"
          helper="One or two sentences. Say when it should run and what you want back."
        >
          <TextArea
            autoFocus
            className={styles.description}
            placeholder={PLACEHOLDER}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {!fields && (
          <div className={styles.generateRow}>
            {generating && <Spinner size="sm" />}
            <span className={styles.hint}>
              {generating
                ? "Drafting the playbook and the schedule…"
                : "Claude drafts it; you review and save."}
            </span>
            <span className={styles.spacer} />
            <Button
              size="sm"
              disabled={generating || description.trim().length === 0}
              onClick={() => {
                generate().catch(() => undefined);
              }}
            >
              Generate draft
            </Button>
          </div>
        )}

        {draft && draft.notes.length > 0 && (
          <Banner tone="warning">
            <ul className={styles.notes}>
              {draft.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Banner>
        )}

        {fields && (
          <div className={styles.draft}>
            <FormField label="Name">
              <Input
                value={fields.name}
                onChange={(e) => patch("name", e.target.value)}
              />
            </FormField>

            <FormField label="Description">
              <Input
                value={fields.description}
                onChange={(e) => patch("description", e.target.value)}
              />
            </FormField>

            <FormField label="Trigger">
              <SegmentedControl
                options={[
                  { label: "Schedule", value: "schedule" as const },
                  { label: "Manual", value: "manual" as const },
                ]}
                value={fields.kind}
                onChange={(value) => patch("kind", value)}
              />
            </FormField>

            {fields.kind === "schedule" && (
              <div className={styles.schedule}>
                <div className={styles.scheduleRow}>
                  <FormField
                    label="Cron"
                    helper="Five fields: min hour dom mon dow."
                    error={scheduleError ?? undefined}
                  >
                    <Input
                      mono
                      value={fields.cron}
                      onChange={(e) => patch("cron", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Timezone">
                    <Input
                      mono
                      value={fields.timezone}
                      onChange={(e) => patch("timezone", e.target.value)}
                    />
                  </FormField>
                </div>
                <CronSchedulePreview
                  error={scheduleError}
                  timezone={fields.timezone}
                  times={previewTimes}
                />
              </div>
            )}

            <FormField
              label="Playbook"
              helper="Markdown instructions handed to the run's agent. Edit it now or later."
            >
              <TextArea
                mono
                className={styles.playbook}
                value={fields.playbook}
                onChange={(e) => patch("playbook", e.target.value)}
              />
            </FormField>

            <p className={styles.hint}>
              {scopeCount === 0 ? "No projects" : `${scopeCount} project(s)`} ·{" "}
              {sourceCount === 0
                ? "no signal sources"
                : `${sourceCount} source(s)`}{" "}
              · autonomy inherits the app default. Saves disabled — turn it on
              once you have read it.
            </p>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {fields && (
          <Button
            size="sm"
            variant="secondary"
            disabled={generating || description.trim().length === 0}
            onClick={() => {
              generate().catch(() => undefined);
            }}
          >
            {generating ? "Regenerating…" : "Regenerate"}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!fields || saving || scheduleError !== null}
          onClick={() => {
            save().catch(() => undefined);
          }}
        >
          {saving ? "Saving…" : "Save automation"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
