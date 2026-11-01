import { describeError } from "@argus/client-core";
import { type ReactNode, useState } from "react";
import { PlayIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { FormField } from "../FormField/FormField";
import { Input, TextArea } from "../Input/Input";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { ToggleList, type ToggleListOption } from "../ToggleList/ToggleList";
import styles from "./QuickRunView.module.css";

export interface QuickRunSpec {
  name: string;
  playbook: string;
  repo_roots: string[];
  /** Null runs on the default model. */
  model: string | null;
}

export interface QuickRunViewProps {
  projects: ToggleListOption[];
  /** Starts the run; rejects with the computer's reason. Omit where this client may not spend. */
  onRun?: (spec: QuickRunSpec) => Promise<unknown>;
  /** Every quick run so far, usually a `RunHistory`. */
  history: ReactNode;
  error?: string | null;
}

/**
 * Run a playbook once against the projects you pick, with nothing saved
 * behind it — and the quick runs so far underneath. Autonomy isn't offered:
 * an ad-hoc run inherits the computer's default, floored by each project.
 */
export function QuickRunView({
  error,
  history,
  onRun,
  projects,
}: QuickRunViewProps) {
  const [name, setName] = useState("");
  const [playbook, setPlaybook] = useState("");
  const [model, setModel] = useState("");
  const [repoRoots, setRepoRoots] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async () => {
    if (!onRun) {
      return;
    }
    setStarting(true);
    setFailure(null);
    try {
      await onRun({
        name: name.trim() || "Quick run",
        playbook,
        repo_roots: repoRoots,
        model: model.trim() || null,
      });
      setPlaybook("");
    } catch (e) {
      setFailure(describeError(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className={styles.view}>
      <p className={styles.intro}>
        A playbook, run once, against the projects you pick. Nothing is saved —
        but you can turn a run into an automation afterwards.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      <SectionPanel
        action={
          onRun && (
            <Button
              disabled={starting || playbook.trim().length === 0}
              leading={<PlayIcon size={11} />}
              size="sm"
              onClick={() => {
                run().catch(() => undefined);
              }}
            >
              {starting ? "Starting…" : "Run once"}
            </Button>
          )
        }
        title="What should it do?"
      >
        <div className={styles.form}>
          <FormField helper="Optional. Labels the run in history." label="Name">
            <Input
              placeholder="Quick run"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField
            helper="Markdown instructions handed to the run's agent."
            label="Playbook"
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
            helper="The run reads these at their paths. It never writes to them."
            label="Projects"
          >
            <ToggleList
              emptyMessage="This computer has no projects registered."
              options={projects}
              selection={repoRoots}
              onChange={setRepoRoots}
            />
          </FormField>
          <FormField helper="Blank uses the computer's default." label="Model">
            <Input
              mono
              placeholder="claude-haiku-4-5"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </FormField>
          {failure && <p className={styles.error}>{failure}</p>}
        </div>
      </SectionPanel>
      {history}
    </div>
  );
}
