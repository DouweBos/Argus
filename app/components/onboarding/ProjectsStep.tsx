import { useState } from "react";
import { Button, Icons, Spinner } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { showOpenProjectDialog } from "../../stores/dialogStore";
import {
  CliProjectList,
  useCliProjectPicker,
} from "../sidebar/CliProjectImportDialog";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./ProjectsStep.module.css";

/** The last step: projects Claude Code has been used in, added in one go. */
export function ProjectsStep() {
  const { complete } = useOnboarding();
  const picker = useCliProjectPicker("onboarding");
  const [importError, setImportError] = useState<string | null>(null);
  const scanning = picker.scan === null && picker.error === null;
  const hasSuggestions = picker.suggestions.length > 0;
  const count = picker.picked.size;

  const importPicked = async () => {
    setImportError(null);
    try {
      await picker.importPicked();
      await complete();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  // The shell's Open Project dialog does the picking once onboarding closes.
  const chooseFolder = async () => {
    await complete();
    showOpenProjectDialog();
  };

  return (
    <OnboardingLayout
      currentStep="projects"
      title="Add your first project"
      subtitle={
        hasSuggestions
          ? "Pick the projects you've used Claude Code in — their chats come along into history — or open another git repository."
          : "Open a git repository on this Mac to start working in it."
      }
      footerRight={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              complete().catch(() => {});
            }}
          >
            Skip for now
          </Button>
          {hasSuggestions && (
            <Button
              variant="primary"
              disabled={count === 0 || picker.importing}
              onClick={() => {
                importPicked().catch(() => {});
              }}
            >
              {count === 1 ? "Import 1 project" : `Import ${count} projects`}
            </Button>
          )}
        </>
      }
    >
      {scanning && (
        <div className={styles.loading}>
          <Spinner size="sm" tone="muted" aria-label="Scanning" />
          <span>Looking through your Claude Code chats…</span>
        </div>
      )}
      {hasSuggestions && (
        <section className={styles.section}>
          <h2 className={styles.heading}>From Claude Code</h2>
          <CliProjectList picker={picker} showAdded={false} />
          {importError !== null && (
            <p className={styles.error}>{importError}</p>
          )}
        </section>
      )}
      <section className={styles.section}>
        {hasSuggestions && <h2 className={styles.heading}>Or add another</h2>}
        <div>
          <Button
            variant={hasSuggestions || scanning ? "secondary" : "primary"}
            leading={<Icons.FolderIcon size={13} />}
            onClick={() => {
              chooseFolder().catch(() => {});
            }}
          >
            Choose a folder…
          </Button>
        </div>
      </section>
    </OnboardingLayout>
  );
}
