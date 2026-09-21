import type { AutomationRun } from "../../../lib/types";
import { useCallback, useState } from "react";
import {
  Button,
  FormField,
  Icons,
  Input,
  RunHistoryRow,
  SectionPanel,
  TextArea,
} from "@argus/peacock";
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  isRunActive,
  isUnreadReport,
} from "../../../lib/automations";
import {
  openAutomations,
  openQuickRun,
  startScratchRun,
  useScratchRuns,
} from "../../../stores/automationStore";
import { useSessionProjects } from "../../../stores/sessionStore";
import { CancelRunButton, RunStatusBadge } from "../RunControls";
import styles from "./QuickRunScreen.module.css";

function HistoryRow({ run }: { run: AutomationRun }) {
  return (
    <RunHistoryRow
      status={<RunStatusBadge status={run.status} />}
      startedAt={formatTimestamp(run.started_at)}
      triggerReason={run.scratch?.name ?? run.trigger_reason}
      duration={formatDuration(run)}
      cost={formatCost(run.cost_usd)}
      error={run.error ?? undefined}
      unread={isUnreadReport(run)}
      onClick={() => openQuickRun(run.id)}
      actions={isRunActive(run) ? <CancelRunButton runId={run.id} /> : null}
    />
  );
}

/**
 * `/automations/quick` — run a playbook once, with nothing saved.
 *
 * The same runner, the same host session, the same ladder as a scheduled run.
 * Autonomy is not offered here on purpose: an ad-hoc run has none of its own,
 * so it inherits the app default and is floored by each project's ceiling.
 */
export function QuickRunScreen() {
  const projects = useSessionProjects();
  const runs = useScratchRuns();
  const [name, setName] = useState("");
  const [playbook, setPlaybook] = useState("");
  const [repoRoots, setRepoRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRepo = useCallback((root: string) => {
    setRepoRoots((roots) =>
      roots.includes(root) ? roots.filter((r) => r !== root) : [...roots, root],
    );
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startScratchRun({
        name: name.trim() || undefined,
        playbook,
        repo_roots: repoRoots,
      });
      setPlaybook("");
      openQuickRun(started.id);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.back}
          onClick={() => openAutomations()}
        >
          <Icons.ChevronLeftIcon size={12} />
          Automations
        </button>
        <span className={styles.spacer} />
      </header>

      <div className={styles.titleBlock}>
        <h1 className={styles.titleHeading}>Quick run</h1>
        <p className={styles.meta}>
          A playbook, run once, against the projects you pick. Nothing is saved
          — but you can turn a run into an automation afterwards.
        </p>
      </div>

      <SectionPanel
        title="What should it do?"
        action={
          <Button
            size="sm"
            disabled={busy || !playbook.trim()}
            onClick={() => {
              run().catch(() => undefined);
            }}
          >
            {busy ? "Starting…" : "Run once"}
          </Button>
        }
      >
        <div className={styles.form}>
          <FormField label="Name" helper="Optional. Labels the run in history.">
            <Input
              placeholder="Quick run"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            label="Playbook"
            helper="Markdown instructions handed to the run's agent."
          >
            <TextArea
              mono
              className={styles.playbook}
              placeholder="Summarise what landed on each project this week."
              value={playbook}
              onChange={(e) => setPlaybook(e.target.value)}
            />
          </FormField>

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
                      checked={repoRoots.includes(project.repoRoot)}
                      onChange={() => toggleRepo(project.repoRoot)}
                    />
                    <span>{project.repoRoot}</span>
                  </label>
                ))
              )}
            </div>
          </FormField>

          {error && <p className={styles.error}>{error}</p>}
        </div>
      </SectionPanel>

      <SectionPanel
        title="Quick runs"
        meta={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
      >
        {runs.length === 0 ? (
          <p className={styles.empty}>
            Nothing yet. A quick run is kept and swept like any other run.
          </p>
        ) : (
          <div className={styles.runs}>
            {runs.map((quickRun) => (
              <HistoryRow key={quickRun.id} run={quickRun} />
            ))}
          </div>
        )}
      </SectionPanel>
    </div>
  );
}
