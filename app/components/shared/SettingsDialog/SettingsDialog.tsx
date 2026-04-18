import { Dialog } from "@argus/peacock";
import {
  PERMISSION_MODE_LABELS,
  hideSettingsDialog,
  setDefaultPermissionMode,
  useDefaultPermissionMode,
  useSettingsDialogOpen,
  type PermissionMode,
} from "../../../stores/settingsStore";
import styles from "./SettingsDialog.module.css";

const MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

export function SettingsDialog() {
  const open = useSettingsDialogOpen();
  if (!open) {
    return null;
  }

  return <SettingsDialogContent />;
}

function SettingsDialogContent() {
  const mode = useDefaultPermissionMode();

  return (
    <Dialog
      title="Settings"
      titleId="settings-dialog-title"
      onClose={hideSettingsDialog}
    >
      <div className={styles.body}>
        <section className={styles.section}>
          <div className={styles.label}>Default permission mode</div>
          <div className={styles.caption}>
            Applied to new agents unless overridden per-workspace.
          </div>
          <div className={styles.options}>
            {MODES.map((m) => (
              <label
                key={m}
                className={`${styles.option} ${mode === m ? styles.optionActive : ""}`}
              >
                <input
                  checked={mode === m}
                  className={styles.radio}
                  name="permission-mode"
                  type="radio"
                  value={m}
                  onChange={() => setDefaultPermissionMode(m)}
                />
                <span>{PERMISSION_MODE_LABELS[m]}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
