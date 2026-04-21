import { useState } from "react";
import { Button, Dialog, Icons, Input } from "@argus/peacock";
import {
  PERMISSION_MODE_LABELS,
  addCustomEditor,
  hideSettingsDialog,
  removeCustomEditor,
  setDefaultPermissionMode,
  updateCustomEditor,
  useCustomEditors,
  useDefaultPermissionMode,
  useSettingsDialogOpen,
  type PermissionMode,
} from "../../../stores/settingsStore";
import {
  THEME_PREFERENCE_LABELS,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "../../../stores/themeStore";
import styles from "./SettingsDialog.module.css";

const MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

const THEMES: ThemePreference[] = ["system", "light", "dark"];

export function SettingsDialog() {
  const open = useSettingsDialogOpen();
  if (!open) {
    return null;
  }

  return <SettingsDialogContent />;
}

function SettingsDialogContent() {
  const mode = useDefaultPermissionMode();
  const theme = useThemePreference();

  return (
    <Dialog
      title="Settings"
      titleId="settings-dialog-title"
      onClose={hideSettingsDialog}
    >
      <div className={styles.body}>
        <section className={styles.section}>
          <div className={styles.label}>Appearance</div>
          <div className={styles.caption}>
            Match your system, or force a specific theme.
          </div>
          <div className={styles.segmented}>
            {THEMES.map((t) => (
              <button
                key={t}
                className={`${styles.segment} ${theme === t ? styles.segmentActive : ""}`}
                type="button"
                onClick={() => setThemePreference(t)}
              >
                {THEME_PREFERENCE_LABELS[t]}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.label}>Default permission mode</div>
          <div className={styles.caption}>
            Applied to new agents unless overridden per-session.
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

        <CustomEditorsSection />
      </div>
    </Dialog>
  );
}

function CustomEditorsSection() {
  const editors = useCustomEditors();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");

  const handleAdd = () => {
    if (!newName.trim() || !newCommand.trim()) {
      return;
    }
    addCustomEditor(newName, newCommand);
    setNewName("");
    setNewCommand("");
    setAdding(false);
  };

  return (
    <section className={styles.section}>
      <div className={styles.label}>Custom &ldquo;Open in&rdquo; apps</div>
      <div className={styles.caption}>
        Add your own apps to the &ldquo;Open in&rdquo; menu. Command is a CLI
        on PATH (e.g. <code>zed</code>, <code>subl</code>) or a path to a{" "}
        <code>.app</code> bundle (e.g. <code>/Applications/Zed.app</code>).
      </div>

      <div className={styles.editorList}>
        {editors.map((ed) => (
          <CustomEditorRow
            key={ed.id}
            id={ed.id}
            name={ed.name}
            command={ed.command}
          />
        ))}
      </div>

      {adding ? (
        <div className={styles.editorForm}>
          <Input
            placeholder="Name (e.g. Zed, Warp)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            mono
            placeholder="Command or .app path"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
          />
          <div className={styles.editorFormActions}>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setNewName("");
                setNewCommand("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newName.trim() || !newCommand.trim()}
              onClick={handleAdd}
            >
              Add app
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          leading={<Icons.PlusIcon size={12} />}
          onClick={() => setAdding(true)}
        >
          Add app
        </Button>
      )}
    </section>
  );
}

interface CustomEditorRowProps {
  command: string;
  id: string;
  name: string;
}

function CustomEditorRow({ id, name, command }: CustomEditorRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftCommand, setDraftCommand] = useState(command);

  if (editing) {
    return (
      <div className={styles.editorForm}>
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <Input
          mono
          value={draftCommand}
          onChange={(e) => setDraftCommand(e.target.value)}
        />
        <div className={styles.editorFormActions}>
          <Button
            variant="ghost"
            onClick={() => {
              setDraftName(name);
              setDraftCommand(command);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!draftName.trim() || !draftCommand.trim()}
            onClick={() => {
              updateCustomEditor(id, {
                name: draftName,
                command: draftCommand,
              });
              setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editorRow}>
      <div className={styles.editorRowText}>
        <div className={styles.editorRowName}>{name}</div>
        <div className={styles.editorRowCommand}>{command}</div>
      </div>
      <div className={styles.editorRowActions}>
        <Button
          variant="ghost"
          leading={<Icons.PencilIcon size={10} />}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          leading={<Icons.TrashIcon size={12} />}
          onClick={() => removeCustomEditor(id)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
