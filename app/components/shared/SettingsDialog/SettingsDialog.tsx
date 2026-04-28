import { useEffect, useState } from "react";
import {
  Button,
  Icons,
  Input,
  SettingsDialogShell,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  Toggle,
  type SettingsDialogGroup,
} from "@argus/peacock";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";
import { setTelemetryEnabled } from "../../../lib/telemetry";
import {
  PERMISSION_MODE_LABELS,
  addCustomEditor,
  hideSettingsDialog,
  removeCustomEditor,
  setDefaultPermissionMode,
  setTelemetryEnabledSetting,
  updateCustomEditor,
  useCustomEditors,
  useDefaultPermissionMode,
  useSettingsDialogOpen,
  useTelemetryEnabled,
  type PermissionMode,
} from "../../../stores/settingsStore";
import {
  THEME_PREFERENCE_LABELS,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "../../../stores/themeStore";
import {
  InheritedMcpList,
  McpServersField,
  entriesToMap,
  entriesValid,
  mapToEntries,
  type McpEntry,
} from "../McpServersField";
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
        {
          id: "mcp",
          label: "MCP servers",
          description: "Personal servers",
          icon: <Icons.GearIcon size={12} />,
          render: () => <McpServersSection />,
        },
        {
          id: "privacy",
          label: "Privacy",
          description: "Telemetry",
          icon: <Icons.HomeIcon size={12} />,
          render: () => <PrivacySection />,
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

type McpSaveState = "error" | "idle" | "saved" | "saving";

function saveButtonLabel(state: McpSaveState): string {
  if (state === "saving") {
    return "Saving…";
  }
  if (state === "saved") {
    return "Saved";
  }

  return "Save";
}

function McpServersSection() {
  const [entries, setEntries] = useState<McpEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<McpSaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (settings) => {
        if (cancelled) {
          return;
        }
        setEntries(mapToEntries(settings.mcp_servers));
        setLoaded(true);
      },
      () => {
        if (!cancelled) {
          setLoaded(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (!entriesValid(entries)) {
      return;
    }
    setSaveState("saving");
    setErrorMsg(null);
    try {
      await setAppSettings({ mcp_servers: entriesToMap(entries) });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      setSaveState("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        action={
          <Button
            disabled={
              !loaded || !entriesValid(entries) || saveState === "saving"
            }
            variant="primary"
            onClick={handleSave}
          >
            {saveButtonLabel(saveState)}
          </Button>
        }
        description={
          <>
            Personal MCP servers merged into every Argus agent on this machine.
            Stored in <code>~/.argus/app-settings.json</code>. Use project
            settings for entries the whole team should get.
          </>
        }
        title="MCP servers"
      />
      <SettingsScreenDetailBody>
        <InheritedMcpList />
        <McpServersField
          emptyLabel="No personal MCP servers"
          entries={entries}
          onChange={setEntries}
        />
        {errorMsg && (
          <p style={{ color: "var(--error)", fontSize: 12 }}>{errorMsg}</p>
        )}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

function PrivacySection() {
  const enabled = useTelemetryEnabled();

  const onChange = (next: boolean) => {
    setTelemetryEnabledSetting(next);
    setTelemetryEnabled(next);
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description={
          <>
            Argus can send anonymous usage and crash data to help us find bugs
            and prioritize features. We never collect file contents, prompts,
            project names, paths, or anything that identifies you. An anonymous
            install id (random UUID) is used so we can group events from the
            same install. Toggle off to disable entirely.
          </>
        }
        title="Anonymous usage & crash reports"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="Send anonymous telemetry">
          <Toggle checked={enabled} onChange={onChange}>
            {enabled ? "Enabled" : "Disabled"}
          </Toggle>
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
