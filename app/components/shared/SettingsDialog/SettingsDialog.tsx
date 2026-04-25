import { useState } from "react";
import {
  Button,
  Icons,
  Input,
  SettingsDialogShell,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  type SettingsDialogGroup,
} from "@argus/peacock";
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
  const groups: SettingsDialogGroup[] = [
    {
      sections: [
        {
          id: "appearance",
          label: "Appearance",
          description: "Theme",
          icon: <Icons.HomeIcon size={12} />,
          render: () => <AppearanceSection />,
        },
        {
          id: "permissions",
          label: "Agents",
          description: "Default permissions",
          icon: <Icons.AgentIcon size={12} />,
          render: () => <PermissionsSection />,
        },
        {
          id: "open-in",
          label: "Open in apps",
          description: "Custom editors",
          icon: <Icons.FolderIcon size={12} />,
          render: () => <OpenInAppsSection />,
        },
      ],
    },
  ];

  return (
    <SettingsDialogShell
      groups={groups}
      title="Settings"
      titleId="settings-dialog-title"
      onClose={hideSettingsDialog}
    />
  );
}

function AppearanceSection() {
  const theme = useThemePreference();

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Match your system, or pin Argus to a specific theme."
        title="Appearance"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="Theme">
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
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

function PermissionsSection() {
  const mode = useDefaultPermissionMode();

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Controls how new agents handle tool calls. You can still override this per session."
        title="Default permission mode"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="When a new agent starts">
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
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

function OpenInAppsSection() {
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
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        action={
          !adding && (
            <Button
              leading={<Icons.PlusIcon size={12} />}
              variant="ghost"
              onClick={() => setAdding(true)}
            >
              Add app
            </Button>
          )
        }
        description={
          <>
            Show your own apps in the &ldquo;Open in&rdquo; menu. Command is a
            CLI on PATH (e.g. <code>zed</code>, <code>subl</code>) or a path to
            a <code>.app</code> bundle.
          </>
        }
        title='Custom "Open in" apps'
      />
      <SettingsScreenDetailBody>
        <div className={styles.editorList}>
          {editors.map((ed) => (
            <CustomEditorRow
              key={ed.id}
              command={ed.command}
              id={ed.id}
              name={ed.name}
            />
          ))}
          {editors.length === 0 && !adding && (
            <div className={styles.emptyHint}>No custom apps yet.</div>
          )}
        </div>

        {adding && (
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
                disabled={!newName.trim() || !newCommand.trim()}
                variant="primary"
                onClick={handleAdd}
              >
                Add app
              </Button>
            </div>
          </div>
        )}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
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
            disabled={!draftName.trim() || !draftCommand.trim()}
            variant="primary"
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
          leading={<Icons.PencilIcon size={10} />}
          variant="ghost"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          leading={<Icons.TrashIcon size={12} />}
          variant="ghost"
          onClick={() => removeCustomEditor(id)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
