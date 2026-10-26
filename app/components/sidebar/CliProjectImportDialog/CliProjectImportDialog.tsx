import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Spinner,
} from "@argus/peacock";
import { useFocusedConnection } from "../../../stores/connectionStore";
import {
  hideCliImportDialog,
  useCliImportVisible,
} from "../../../stores/dialogStore";
import { pushError } from "../../../stores/notificationsStore";
import styles from "./CliProjectImportDialog.module.css";
import { CliProjectList } from "./CliProjectList";
import { useCliProjectPicker } from "./useCliProjectPicker";

/** Mounted once by the shell; opened via `showCliImportDialog()`. */
export function CliProjectImportDialog() {
  const visible = useCliImportVisible();

  return visible ? <ImportDialog /> : null;
}

function ImportDialog() {
  const { hostId } = useFocusedConnection();
  const picker = useCliProjectPicker("dialog", hostId);
  const { scan, error, importing } = picker;
  const count = picker.picked.size;

  const handleImport = async () => {
    try {
      await picker.importPicked();
      hideCliImportDialog();
    } catch (err) {
      pushError(
        err instanceof Error ? err.message : String(err),
        "import_cli_projects",
      );
    }
  };

  return (
    <Dialog
      title="Import projects from Claude Code"
      titleId="cli-project-import-title"
      size="medium"
      onClose={hideCliImportDialog}
    >
      <DialogBody className={styles.body}>
        <p className={styles.subtitle}>
          Projects you&apos;ve used the Claude Code CLI in, with how many chats
          each has.
        </p>
        {error !== null && <p className={styles.error}>{error}</p>}
        {error === null && scan === null && (
          <div className={styles.loading}>
            <Spinner size="sm" tone="muted" aria-label="Scanning" />
            <span>Looking through your Claude Code chats…</span>
          </div>
        )}
        {scan !== null && scan.candidates.length === 0 && (
          <EmptyState title="No Claude Code projects found" />
        )}
        {scan !== null && scan.candidates.length > 0 && (
          <CliProjectList picker={picker} />
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={hideCliImportDialog}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={count === 0 || importing}
          onClick={() => {
            handleImport().catch(() => {});
          }}
        >
          {count === 1 ? "Import 1 project" : `Import ${count} projects`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
