import type { AutonomyChoice } from "./AutonomyFields";
import type {
  Automation,
  AutomationGuardrails,
  AutomationTrigger,
  SignalSourceInfo,
} from "../../../lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  CronSchedulePreview,
  FormField,
  Input,
  SectionPanel,
  SegmentedControl,
  TextArea,
  Toggle,
} from "@argus/peacock";
import {
  cronError,
  formatTimestamp,
  localTimezone,
  nextFireTimes,
} from "../../../lib/automations";
import { listSignalSources } from "../../../lib/ipc";
import { saveAutomation } from "../../../stores/automationStore";
import { useSessionProjects } from "../../../stores/sessionStore";
import styles from "./AutomationEditor.module.css";
import { AutonomyFields } from "./AutonomyFields";

const PREVIEW_COUNT = 5;

/** Availability is a host question, so it is asked once per mount. */
function useSignalSources(): SignalSourceInfo[] {
  const [sources, setSources] = useState<SignalSourceInfo[]>([]);
  useEffect(() => {
    let live = true;
    listSignalSources()
      .then((list) => live && setSources(list))
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  return sources;
}

interface Draft {
  autonomy: AutonomyChoice;
  catchUp: boolean;
  cron: string;
  description: string;
  guardrails: AutomationGuardrails;
  kind: AutomationTrigger["kind"];
  model: string;
  name: string;
  playbook: string;
  repoRoots: string[];
  sourceIds: string[];
  timezone: string;
}

function toDraft(automation: Automation): Draft {
  const schedule =
    automation.trigger.kind === "schedule" ? automation.trigger : null;

  return {
    name: automation.name,
    description: automation.description,
    playbook: automation.playbook,
    model: automation.model ?? "",
    kind: automation.trigger.kind,
    cron: schedule?.cron ?? "0 9 * * 1-5",
    timezone: schedule?.timezone ?? localTimezone(),
    catchUp: schedule?.catch_up ?? true,
    repoRoots: automation.scope.repo_roots,
    sourceIds: automation.source_ids,
    autonomy: automation.autonomy ?? "inherit",
    guardrails: automation.guardrails,
  };
}

function toTrigger(draft: Draft): AutomationTrigger {
  return draft.kind === "schedule"
    ? {
        kind: "schedule",
        cron: draft.cron.trim(),
        timezone: draft.timezone.trim() || localTimezone(),
        catch_up: draft.catchUp,
      }
    : { kind: "manual" };
}

/** Config editor for one automation. Saves explicitly — nothing autosaves. */
export function AutomationEditor({ automation }: { automation: Automation }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(automation));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useSessionProjects();
  const sources = useSignalSources();

  // Save is explicit, so the button only lights up once the form differs from
  // what the host holds.
  const clean = useMemo(
    () => JSON.stringify(draft) === JSON.stringify(toDraft(automation)),
    [draft, automation],
  );

  const scheduleError =
    draft.kind === "schedule" ? cronError(draft.cron, draft.timezone) : null;
  const previewTimes = useMemo(
    () =>
      draft.kind === "schedule" && !scheduleError
        ? nextFireTimes(draft.cron, draft.timezone, PREVIEW_COUNT).map((t) =>
            formatTimestamp(t),
          )
        : [],
    [draft.kind, draft.cron, draft.timezone, scheduleError],
  );

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleRepo = useCallback((root: string) => {
    setDraft((d) => ({
      ...d,
      repoRoots: d.repoRoots.includes(root)
        ? d.repoRoots.filter((r) => r !== root)
        : [...d.repoRoots, root],
    }));
  }, []);

  const toggleSource = useCallback((id: string) => {
    setDraft((d) => ({
      ...d,
      sourceIds: d.sourceIds.includes(id)
        ? d.sourceIds.filter((s) => s !== id)
        : [...d.sourceIds, id],
    }));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAutomation(automation.id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        playbook: draft.playbook,
        model: draft.model.trim() || null,
        trigger: toTrigger(draft),
        scope: { repo_roots: draft.repoRoots },
        source_ids: draft.sourceIds,
        autonomy: draft.autonomy === "inherit" ? null : draft.autonomy,
        guardrails: draft.guardrails,
      });
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setSaving(false);
    }
  };

  let saveLabel = "Save changes";
  if (saving) {
    saveLabel = "Saving…";
  } else if (clean) {
    saveLabel = "Saved";
  }

  return (
    <SectionPanel
      title="Configuration"
      action={
        <Button
          size="sm"
          disabled={saving || clean || scheduleError !== null}
          onClick={() => {
            save().catch(() => undefined);
          }}
        >
          {saveLabel}
        </Button>
      }
    >
      <div className={styles.form}>
        <FormField label="Name">
          <Input
            value={draft.name}
            onChange={(e) => patch("name", e.target.value)}
          />
        </FormField>

        <FormField label="Description" helper="Shown in the automations list.">
          <Input
            value={draft.description}
            onChange={(e) => patch("description", e.target.value)}
          />
        </FormField>

        <FormField
          label="Trigger"
          helper="A schedule fires on the clock; manual only ever fires when you press Run."
        >
          <SegmentedControl
            options={[
              { label: "Schedule", value: "schedule" as const },
              { label: "Manual", value: "manual" as const },
            ]}
            value={draft.kind}
            onChange={(value) => patch("kind", value)}
          />
        </FormField>

        {draft.kind === "schedule" && (
          <div className={styles.schedule}>
            <FormField
              label="Cron"
              helper="Five fields: min hour dom mon dow."
              error={scheduleError ?? undefined}
            >
              <Input
                mono
                value={draft.cron}
                onChange={(e) => patch("cron", e.target.value)}
              />
            </FormField>
            <FormField label="Timezone">
              <Input
                mono
                value={draft.timezone}
                onChange={(e) => patch("timezone", e.target.value)}
              />
            </FormField>
            <div className={styles.preview}>
              <CronSchedulePreview
                error={scheduleError}
                timezone={draft.timezone}
                times={previewTimes}
              />
            </div>
            <label className={styles.catchUp}>
              <Toggle
                checked={draft.catchUp}
                onChange={(checked) => patch("catchUp", checked)}
              />
              <span>
                Catch up on a missed window — fires once, never backfills.
              </span>
            </label>
          </div>
        )}

        <FormField
          label="Projects"
          helper="The run reads these at their absolute paths. It never writes to them."
        >
          <div className={styles.repos}>
            {projects.length === 0 ? (
              <span className={styles.noRepos}>No projects are open.</span>
            ) : (
              projects.map((project) => (
                <label key={project.repoRoot} className={styles.repo}>
                  <input
                    type="checkbox"
                    checked={draft.repoRoots.includes(project.repoRoot)}
                    onChange={() => toggleRepo(project.repoRoot)}
                  />
                  <span>{project.repoRoot}</span>
                </label>
              ))
            )}
          </div>
        </FormField>

        <FormField
          label="Signal sources"
          helper="Where the run's work items come from. Argus fetches native sources itself; an agent source is fetched by the run's own agent through its MCP tools."
        >
          <div className={styles.repos}>
            {sources.length === 0 ? (
              <span className={styles.noRepos}>No sources are available.</span>
            ) : (
              sources.map((source) => (
                <label key={source.id} className={styles.source}>
                  <input
                    type="checkbox"
                    checked={draft.sourceIds.includes(source.id)}
                    onChange={() => toggleSource(source.id)}
                  />
                  <span>{source.label}</span>
                  <span className={styles.sourceMode}>
                    {source.available
                      ? source.mode
                      : `${source.mode} · not configured`}
                  </span>
                </label>
              ))
            )}
          </div>
        </FormField>

        <FormField
          label="Model"
          helper="Blank uses the default model for new agents."
        >
          <Input
            mono
            placeholder="e.g. opus, sonnet"
            value={draft.model}
            onChange={(e) => patch("model", e.target.value)}
          />
        </FormField>

        <AutonomyFields
          autonomy={draft.autonomy}
          guardrails={draft.guardrails}
          onAutonomyChange={(value) => patch("autonomy", value)}
          onGuardrailsChange={(value) => patch("guardrails", value)}
        />

        <FormField
          label="Playbook"
          helper="Markdown instructions handed to the run's agent."
        >
          <TextArea
            mono
            className={styles.playbook}
            value={draft.playbook}
            onChange={(e) => patch("playbook", e.target.value)}
          />
        </FormField>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </SectionPanel>
  );
}
