import {
  cronLabel,
  describeError,
  draftScheduleError,
  localTimezone,
} from "@argus/client-core";
import type { RemoteAutomationDetail } from "@argus/remote-protocol";
import { useState } from "react";
import { SparklesIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { FormField } from "../FormField/FormField";
import { Input, TextArea } from "../Input/Input";
import { Spinner } from "../Spinner/Spinner";
import styles from "./DescribeAutomationView.module.css";

const PLACEHOLDER =
  "Every weekday at 8am, look at my open PRs and tell me which ones have gone stale.";

export interface AutomationDraftResult {
  automation: RemoteAutomationDetail;
  /** What the drafter changed or couldn't do, for the user to read first. */
  notes: string[];
}

export interface DescribeAutomationViewProps {
  /** Rejects with the computer's reason. */
  onDraft: (
    description: string,
    regenerating: boolean,
  ) => Promise<AutomationDraftResult>;
  /** Saves it paused. Rejects with the computer's reason. */
  onCreate: (draft: RemoteAutomationDetail) => Promise<unknown>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * "Describe it": a sentence in, a draft automation out, reviewed right
 * underneath. It saves paused — a generated automation is never live on
 * arrival.
 */
export function DescribeAutomationView({
  onCreate,
  onDraft,
}: DescribeAutomationViewProps) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<RemoteAutomationDetail | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [working, setWorking] = useState<"create" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setWorking("draft");
    setError(null);
    try {
      const result = await onDraft(text.trim(), draft !== null);
      setDraft(result.automation);
      setNotes(result.notes);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setWorking(null);
    }
  };

  const create = async () => {
    if (!draft) {
      return;
    }
    setWorking("create");
    setError(null);
    try {
      await onCreate({
        ...draft,
        name: draft.name.trim() || "New automation",
        enabled: false,
        autonomy: null,
      });
    } catch (e) {
      setError(describeError(e));
      setWorking(null);
    }
  };

  const patch = (value: Partial<RemoteAutomationDetail>) =>
    setDraft((d) => (d ? { ...d, ...value } : d));
  const scheduleError = draft ? draftScheduleError(draft) : null;

  return (
    <div className={styles.view}>
      <FormField
        helper="One or two sentences. Say when it should run and what you want back."
        label="What should it do?"
      >
        <TextArea
          autoFocus
          className={styles.description}
          placeholder={PLACEHOLDER}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </FormField>

      <div className={styles.row}>
        {working === "draft" && <Spinner size="sm" />}
        <span className={styles.hint}>
          {working === "draft"
            ? "Drafting the playbook and the schedule…"
            : "Claude drafts it; you review it and create it."}
        </span>
        <span className={styles.spacer} />
        <Button
          disabled={working !== null || text.trim().length === 0}
          leading={<SparklesIcon size={11} />}
          size="sm"
          variant={draft ? "secondary" : "primary"}
          onClick={() => {
            generate().catch(() => undefined);
          }}
        >
          {draft ? "Regenerate" : "Draft it"}
        </Button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {draft && (
        <section className={styles.draft}>
          {notes.length > 0 && (
            <Banner tone="info">
              <ul className={styles.notes}>
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Banner>
          )}
          <FormField label="Name">
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </FormField>
          <FormField label="Description">
            <Input
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </FormField>
          <div className={styles.schedule}>
            {draft.trigger_kind === "schedule" && draft.cron ? (
              <>
                <span className={styles.scheduleHeadline}>
                  {cronLabel(draft.cron)}
                </span>
                <span className={styles.scheduleCron}>
                  {draft.cron} · {draft.timezone ?? localTimezone()}
                </span>
                {scheduleError && (
                  <span className={styles.error}>{scheduleError}</span>
                )}
              </>
            ) : (
              <span className={styles.hint}>
                Manual — runs only when someone presses Run now.
              </span>
            )}
          </div>
          <FormField
            helper="Markdown instructions handed to the run's agent. Edit it now or later."
            label="Playbook"
          >
            <TextArea
              mono
              className={styles.playbook}
              value={draft.playbook}
              onChange={(e) => patch({ playbook: e.target.value })}
            />
          </FormField>
          <div className={styles.row}>
            <span className={styles.hint}>
              {draft.repo_roots.length === 0
                ? "No projects"
                : plural(draft.repo_roots.length, "project")}{" "}
              ·{" "}
              {draft.source_ids.length === 0
                ? "no signal sources"
                : plural(draft.source_ids.length, "source")}{" "}
              · autonomy inherits the computer's default. Saves paused — turn it
              on once you have read it.
            </span>
            <span className={styles.spacer} />
            <Button
              disabled={working !== null || scheduleError !== null}
              size="sm"
              onClick={() => {
                create().catch(() => undefined);
              }}
            >
              {working === "create" ? "Creating…" : "Create"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
