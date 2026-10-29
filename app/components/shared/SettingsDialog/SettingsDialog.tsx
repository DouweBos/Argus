import type { LaunchRoute } from "../../../lib/launchRoute";
import type { PrereqId } from "../../../lib/types";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ColorThemePicker,
  Icons,
  Input,
  SegmentedControl,
  SettingsDialogShell,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  Toggle,
  type SettingsDialogGroup,
} from "@argus/peacock";
import {
  getAppSettings,
  gitGetConfig,
  gitSetConfig,
  setAppSettings,
} from "../../../lib/ipc";
import { getLastKnownCapabilities } from "../../../lib/lastKnownCapabilities";
import { setTelemetryMode } from "../../../lib/telemetry";
import { setColorTheme, useColorTheme } from "../../../stores/colorThemeStore";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { useSelectedSessionId } from "../../../stores/sessionStore";
import {
  PERMISSION_MODE_LABELS,
  addCustomEditor,
  hideSettingsDialog,
  removeCustomEditor,
  setConventionalCommitsPicker,
  setDefaultLlmModel,
  setDefaultLlmRunner,
  setDefaultModel,
  setDefaultPermissionMode,
  setStartWorkspace,
  setDefaultPullStrategy,
  setDiffView,
  setDiffWhitespace,
  setDiffWordDiff,
  setShowAssumeUnchangedFiles,
  setShowIgnoredFiles,
  setShowNonModifiedFiles,
  setTelemetryModeSetting,
  setWorkingCopyView,
  updateCustomEditor,
  useConventionalCommitsPicker,
  useCustomEditors,
  useDefaultLlm,
  useDefaultModel,
  useDefaultPermissionMode,
  useStartWorkspace,
  useDefaultPullStrategy,
  useDiffView,
  useDiffWhitespace,
  useDiffWordDiff,
  useSettingsDialogOpen,
  useSettingsDialogRequest,
  useSettingsInitialSection,
  useShowAssumeUnchangedFiles,
  useShowIgnoredFiles,
  useShowNonModifiedFiles,
  useTelemetryMode,
  useWorkingCopyView,
  type DiffViewMode,
  type PermissionMode,
  type TelemetryMode,
  type WorkingCopyView,
  type StartWorkspace,
} from "../../../stores/settingsStore";
import {
  THEME_PREFERENCE_LABELS,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "../../../stores/themeStore";
import {
  UI_SCALE_LABELS,
  UI_SCALE_ORDER,
  setUiScale,
  useUiScale,
} from "../../../stores/uiScaleStore";
import {
  InheritedMcpList,
  McpServersField,
  entriesToMap,
  entriesValid,
  mapToEntries,
  type McpEntry,
} from "../McpServersField";
import { PrereqList } from "../PrereqList";
import { AccountSection } from "./AccountSection";
import { AutomationDefaults } from "./AutomationDefaults";
import { ClaudeAccountSection } from "./ClaudeAccountSection";
import { CustomRunnersSection } from "./CustomRunnersSection";
import { FollowUpSuggestionsToggle } from "./FollowUpSuggestionsToggle";
import { HostsSection } from "./HostsSection";
import { ImportCliChatsField } from "./ImportCliChatsField";
import { IntegrationsSection } from "./IntegrationsSection";
import { RemoteAccessSection } from "./RemoteAccessSection";
import styles from "./SettingsDialog.module.css";
import { ToolsSection } from "./ToolsSection";
import { WarmAgentsSetting } from "./WarmAgentsSetting";
import { WorktreesSection } from "./WorktreesSection";

const MODES: PermissionMode[] = ["auto", "ask", "plan", "review", "trusted"];

const THEMES: ThemePreference[] = ["system", "light", "dark"];

export function SettingsDialog() {
  const open = useSettingsDialogOpen();
  if (!open) {
    return null;
  }

  return <SettingsDialogContent />;
}

const START_WORKSPACES: [StartWorkspace, string][] = [
  ["worktree", "New worktree"],
  ["current", "Current checkout"],
];

function SettingsDialogContent() {
  const initialSection = useSettingsInitialSection();
  const request = useSettingsDialogRequest();
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
          id: "claude-account",
          label: "Claude account",
          description: "Sign in & switch accounts",
          icon: <Icons.OrganizationIcon size={12} />,
          render: () => <ClaudeAccountSection />,
        },
        {
          id: "permissions",
          label: "Agents",
          description: "Default permissions",
          icon: <Icons.AgentIcon size={12} />,
          render: () => <PermissionsSection />,
        },
        {
          id: "tools",
          label: "Tools",
          description: "Bundled tools",
          icon: <Icons.SimulatorIcon size={12} />,
          render: () => <ToolsSection />,
        },
        {
          id: "llm",
          label: "LLM",
          description: "Default runner & model",
          icon: <Icons.OrchestrationIcon size={12} />,
          render: () => <LlmSection />,
        },
        {
          id: "custom-runners",
          label: "Custom runners",
          description: "Bring your own endpoint",
          icon: <Icons.OrchestrationIcon size={12} />,
          render: () => <CustomRunnersSection />,
        },
        {
          id: "open-in",
          label: "Open in apps",
          description: "Custom editors",
          icon: <Icons.FolderIcon size={12} />,
          render: () => <OpenInAppsSection />,
        },
        {
          id: "worktrees",
          label: "Worktrees",
          description: "Where sessions are stored",
          icon: <Icons.DriveIcon size={12} />,
          render: () => <WorktreesSection />,
        },
        {
          id: "integrations",
          label: "Integrations",
          description: "Linear and Figma",
          icon: <Icons.LinkIcon size={12} />,
          render: () => <IntegrationsSection />,
        },
        {
          id: "mcp",
          label: "MCP servers",
          description: "Personal servers",
          icon: <Icons.GearIcon size={12} />,
          render: () => <McpServersSection />,
        },
        {
          id: "account",
          label: "Account",
          description: "Find and link your computers",
          icon: <Icons.HostIcon size={12} />,
          render: () => <AccountSection />,
        },
        {
          id: "remote-access",
          label: "Remote access",
          description: "Phone & web control",
          icon: <Icons.SimulatorIcon size={12} />,
          render: () => <RemoteAccessSection />,
        },
        {
          id: "hosts",
          label: "Hosts",
          description: "Run agents on another Mac",
          icon: <Icons.HostIcon size={12} />,
          render: () => <HostsSection />,
        },
        {
          id: "git",
          label: "Git",
          description: "Diff, working copy, pull",
          icon: <Icons.MergeIcon size={12} />,
          render: () => <GitSection />,
        },
        {
          id: "git-signing",
          label: "Git signing",
          description: "Commit signing keys",
          icon: <Icons.BranchIcon size={12} />,
          render: () => <GitSigningSection />,
        },
        {
          id: "privacy",
          label: "Privacy",
          description: "Telemetry",
          icon: <Icons.HomeIcon size={12} />,
          render: () => <PrivacySection />,
        },
        {
          id: "advanced",
          label: "Advanced",
          description: "Update channel",
          icon: <Icons.GearIcon size={12} />,
          render: () => <AdvancedSection />,
        },
      ],
    },
  ];

  return (
    <SettingsDialogShell
      key={request}
      groups={groups}
      title="Settings"
      titleId="settings-dialog-title"
      initialSectionId={initialSection}
      onClose={hideSettingsDialog}
    />
  );
}

function AppearanceSection() {
  const theme = useThemePreference();
  const colorTheme = useColorTheme();
  const scale = useUiScale();

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Match your system theme, pick a colour theme and how dense Argus's UI feels."
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
        <SettingsScreenField
          label="Colour theme"
          caption="Accent colour and background tint, in both light and dark."
        >
          <ColorThemePicker value={colorTheme} onChange={setColorTheme} />
        </SettingsScreenField>
        <SettingsScreenField
          label="Display size"
          caption="Scale the entire UI larger for readability or smaller for more space."
        >
          <div className={styles.segmented}>
            {UI_SCALE_ORDER.map((s) => (
              <button
                key={s}
                className={`${styles.segment} ${scale === s ? styles.segmentActive : ""}`}
                type="button"
                onClick={() => setUiScale(s)}
              >
                {UI_SCALE_LABELS[s]}
              </button>
            ))}
          </div>
        </SettingsScreenField>
        <LaunchRouteField />
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

/**
 * Which screen Argus opens on. Host state like the automations switch: the
 * inbox it would open is that machine's inbox.
 */
function LaunchRouteField() {
  const [route, setRoute] = useState<LaunchRoute>("home");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (settings) => {
        if (!cancelled) {
          setRoute(settings.launch_route ?? "home");
          setLoaded(true);
        }
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

  const change = (next: LaunchRoute) => {
    const previous = route;
    setRoute(next);
    setAppSettings({ launch_route: next }).catch(() => setRoute(previous));
  };

  return (
    <SettingsScreenField
      label="Launch screen"
      caption="Where Argus lands when it opens. Restored window tabs still win."
    >
      <SegmentedControl<LaunchRoute>
        aria-label="Launch screen"
        onChange={change}
        options={[
          { value: "home", label: "Home", disabled: !loaded },
          { value: "inbox", label: "Inbox", disabled: !loaded },
        ]}
        value={route}
      />
    </SettingsScreenField>
  );
}

/**
 * Master switch for the automation scheduler. Host state rather than renderer
 * state, so it follows whichever machine the automations live on.
 */
function AutomationsToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (settings) => {
        if (!cancelled) {
          setEnabled(settings.automations_enabled !== false);
          setLoaded(true);
        }
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

  const change = (next: boolean) => {
    setEnabled(next);
    setAppSettings({ automations_enabled: next }).catch(() => {
      setEnabled(!next);
    });
  };

  return (
    <SettingsScreenField
      label="Automations"
      caption="Let automations start agents on their schedule. Running one by hand always works."
    >
      <Toggle checked={enabled} disabled={!loaded} onChange={change}>
        Run automations on their schedule
      </Toggle>
    </SettingsScreenField>
  );
}

function PermissionsSection() {
  const mode = useDefaultPermissionMode();
  const startWorkspace = useStartWorkspace();
  const defaultModel = useDefaultModel();
  const knownModels = useMemo(() => getLastKnownCapabilities().models, []);

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Defaults applied when starting a new agent. Both can be overridden per session."
        title="Agents"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Default model"
          caption={
            knownModels.length === 0
              ? "Start an agent at least once to populate the model list."
              : "Pre-selected in the launcher and new-session dialog."
          }
        >
          <select
            value={defaultModel}
            disabled={knownModels.length === 0}
            onChange={(e) => setDefaultModel(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: "var(--border-radius-small)",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
            }}
          >
            <option value="">Use Claude CLI default</option>
            {knownModels.map((m) => (
              <option key={m.value} value={m.value}>
                {m.displayName}
              </option>
            ))}
          </select>
        </SettingsScreenField>
        <SettingsScreenField label="Default permission mode">
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
        <FollowUpSuggestionsToggle />
        <WarmAgentsSetting />
        <SettingsScreenField
          label="Start new agents in"
          caption="What a prompt on a project's home runs in. You can switch it per prompt."
        >
          <div className={styles.segmented}>
            {START_WORKSPACES.map(([value, label]) => (
              <button
                key={value}
                className={`${styles.segment} ${startWorkspace === value ? styles.segmentActive : ""}`}
                type="button"
                onClick={() => setStartWorkspace(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </SettingsScreenField>
        <ImportCliChatsField />
        <AutomationsToggle />
        <AutomationDefaults />
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

function LlmSection() {
  const llm = useDefaultLlm();
  // Mirror the choice into ~/.argus/app-settings.json so sessions created
  // outside the UI (MCP, remote) resolve the same runner.
  const mirror = (next: { model?: string | null; runner?: string | null }) => {
    setAppSettings({ default_llm: { ...llm, ...next } }).catch(() => undefined);
  };
  const registered = useRegisteredRunners();
  // Fall back to a local "claude-code" entry if the IPC hasn't returned
  // yet — the picker can never render an empty list. The list is replaced
  // by the registry's display names as soon as the IPC resolves.
  const runnerOptions =
    registered.length > 0
      ? registered.map((r) => ({ id: r.id, label: r.displayName }))
      : [{ id: "claude-code", label: "Claude Code" }];
  const runner = llm.runner ?? runnerOptions[0]?.id ?? null;

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Pick the LLM runner and default model used for new sessions. Projects (.argus.json) and individual sessions can override these."
        title="Default LLM"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Runner"
          caption="The CLI/agent that drives sessions. The runner is fixed once a session is created."
        >
          <div className={styles.options}>
            {runnerOptions.map((opt) => (
              <label
                key={opt.id}
                className={`${styles.option} ${runner === opt.id ? styles.optionActive : ""}`}
              >
                <input
                  checked={runner === opt.id}
                  className={styles.radio}
                  name="default-llm-runner"
                  type="radio"
                  value={opt.id}
                  onChange={() => {
                    setDefaultLlmRunner(opt.id);
                    mirror({ runner: opt.id });
                  }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </SettingsScreenField>

        <SettingsScreenField
          label="Default model"
          caption="Optional. Leave blank to let the runner pick its default model. Project and session settings override this."
        >
          <Input
            mono
            placeholder="e.g. claude-opus-4-7 (leave blank for runner default)"
            value={llm.model ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setDefaultLlmModel(next);
              mirror({ model: next });
            }}
          />
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
  const mode = useTelemetryMode();

  const onChange = (next: TelemetryMode) => {
    setTelemetryModeSetting(next);
    setTelemetryMode(next);
  };

  const description = (() => {
    switch (mode) {
      case "presence":
        return "One anonymous heartbeat per launch — install id and app version, nothing else. Lets us count daily active users without learning what anyone does. This is the minimum; it can't be turned off.";
      case "full":
        return "Anonymous install id, app/OS info, feature usage, errors, and crashes. Never file contents, prompts, project names, branch names, or paths.";
    }
  })();

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description={
          <>
            Choose how much Argus shares with us. The full event catalogue is
            documented in <code>docs/telemetry-events.md</code>. {description}
          </>
        }
        title="Anonymous usage & crash reports"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="Telemetry">
          <SegmentedControl<TelemetryMode>
            aria-label="Telemetry mode"
            value={mode}
            onChange={onChange}
            options={[
              { value: "presence", label: "Just count me" },
              { value: "full", label: "Full analytics" },
            ]}
          />
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

const GIT_IDENTITY_PREREQ: PrereqId[] = ["git_identity"];

const WORKING_COPY_VIEWS: { label: string; value: WorkingCopyView }[] = [
  { label: "Flat list", value: "flat" },
  { label: "Tree", value: "tree" },
];

const DIFF_VIEWS: { label: string; value: DiffViewMode }[] = [
  { label: "Unified", value: "unified" },
  { label: "Side-by-side", value: "split" },
];

const PULL_STRATEGIES: {
  label: string;
  value: "ff-only" | "merge" | "rebase";
}[] = [
  { label: "Fast-forward only", value: "ff-only" },
  { label: "Merge", value: "merge" },
  { label: "Rebase", value: "rebase" },
];

function GitSection() {
  const workingCopyView = useWorkingCopyView();
  const diffView = useDiffView();
  const diffWhitespace = useDiffWhitespace();
  const diffWordDiff = useDiffWordDiff();
  const conventionalCommits = useConventionalCommitsPicker();
  const pullStrategy = useDefaultPullStrategy();
  const showIgnored = useShowIgnoredFiles();
  const showAssumeUnchanged = useShowAssumeUnchangedFiles();
  const showNonModified = useShowNonModifiedFiles();

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Defaults for the git panel — working copy view, diff display, and pull strategy. The toolbar in each panel can still override these per session."
        title="Git"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Git identity"
          caption="The name and email every commit Argus makes is authored with."
        >
          <PrereqList ids={GIT_IDENTITY_PREREQ} />
        </SettingsScreenField>

        <SettingsScreenField label="Working copy view">
          <div className={styles.segmented}>
            {WORKING_COPY_VIEWS.map((v) => (
              <button
                key={v.value}
                className={`${styles.segment} ${workingCopyView === v.value ? styles.segmentActive : ""}`}
                type="button"
                onClick={() => setWorkingCopyView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </SettingsScreenField>

        <SettingsScreenField label="Diff layout">
          <div className={styles.segmented}>
            {DIFF_VIEWS.map((v) => (
              <button
                key={v.value}
                className={`${styles.segment} ${diffView === v.value ? styles.segmentActive : ""}`}
                type="button"
                onClick={() => setDiffView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </SettingsScreenField>

        <SettingsScreenField
          label="Ignore whitespace in diffs"
          caption="Hide pure-whitespace changes when comparing files."
        >
          <Toggle checked={diffWhitespace} onChange={setDiffWhitespace}>
            {diffWhitespace ? "On" : "Off"}
          </Toggle>
        </SettingsScreenField>

        <SettingsScreenField
          label="Highlight word-level changes"
          caption="Inline word-diff inside changed lines."
        >
          <Toggle checked={diffWordDiff} onChange={setDiffWordDiff}>
            {diffWordDiff ? "On" : "Off"}
          </Toggle>
        </SettingsScreenField>

        <SettingsScreenField
          label="Conventional Commits picker"
          caption="Show a commit-type prefix picker (feat, fix, chore, …) in the commit composer."
        >
          <Toggle
            checked={conventionalCommits}
            onChange={setConventionalCommitsPicker}
          >
            {conventionalCommits ? "On" : "Off"}
          </Toggle>
        </SettingsScreenField>

        <SettingsScreenField
          label="Default pull strategy"
          caption="Used when you pull from the project-scope dialog without picking a strategy."
        >
          <div className={styles.options}>
            {PULL_STRATEGIES.map((s) => (
              <label
                key={s.value}
                className={`${styles.option} ${pullStrategy === s.value ? styles.optionActive : ""}`}
              >
                <input
                  checked={pullStrategy === s.value}
                  className={styles.radio}
                  name="pull-strategy"
                  type="radio"
                  value={s.value}
                  onChange={() => setDefaultPullStrategy(s.value)}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </SettingsScreenField>

        <SettingsScreenField
          label="Show ignored files"
          caption="Include files matched by .gitignore in the working copy list."
        >
          <Toggle checked={showIgnored} onChange={setShowIgnoredFiles}>
            {showIgnored ? "On" : "Off"}
          </Toggle>
        </SettingsScreenField>

        <SettingsScreenField
          label="Show assume-unchanged files"
          caption="Include files marked with `git update-index --assume-unchanged`."
        >
          <Toggle
            checked={showAssumeUnchanged}
            onChange={setShowAssumeUnchangedFiles}
          >
            {showAssumeUnchanged ? "On" : "Off"}
          </Toggle>
        </SettingsScreenField>

        <SettingsScreenField
          label="Show unmodified files in tree view"
          caption="Only applies when the working copy view is set to Tree."
        >
          <Toggle checked={showNonModified} onChange={setShowNonModifiedFiles}>
            {showNonModified ? "On" : "Off"}
          </Toggle>
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

/** Phase 7 T4 — per-repo commit-signing toggles. */
function GitSigningSection() {
  const sessionId = useSelectedSessionId();
  const [enabled, setEnabled] = useState(false);
  const [format, setFormat] = useState<"gpg" | "ssh">("gpg");
  const [signingKey, setSigningKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [loading, setLoading] = useState(Boolean(sessionId));

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [gpgsign, fmt, key] = await Promise.all([
          gitGetConfig(sessionId, "commit.gpgsign"),
          gitGetConfig(sessionId, "gpg.format"),
          gitGetConfig(sessionId, "user.signingkey"),
        ]);
        if (cancelled) {
          return;
        }
        setEnabled(gpgsign === "true");
        setFormat(fmt === "ssh" ? "ssh" : "gpg");
        setSigningKey(key ?? "");
        setKeyDraft(key ?? "");
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <SettingsScreenDetail>
        <SettingsScreenDetailHeader
          description="Open a session to configure per-repo commit signing."
          title="Git signing"
        />
      </SettingsScreenDetail>
    );
  }

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    try {
      await gitSetConfig(sessionId, "commit.gpgsign", next ? "true" : "");
    } catch {
      setEnabled(!next);
    }
  };

  const updateFormat = async (next: "gpg" | "ssh") => {
    setFormat(next);
    try {
      await gitSetConfig(sessionId, "gpg.format", next);
    } catch {
      // ignore — best effort
    }
  };

  const saveKey = async () => {
    setSigningKey(keyDraft);
    try {
      await gitSetConfig(sessionId, "user.signingkey", keyDraft.trim());
    } catch {
      // ignore — best effort
    }
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Per-repo commit signing. Argus writes commit.gpgsign / gpg.format / user.signingkey to the local config."
        title="Git signing"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="Enable commit signing">
          <label className={styles.option}>
            <input
              checked={enabled}
              className={styles.radio}
              disabled={loading}
              type="checkbox"
              onChange={(e) => toggleEnabled(e.target.checked)}
            />
            <span>Sign all commits in this repo</span>
          </label>
        </SettingsScreenField>

        <SettingsScreenField label="Signing format">
          <div className={styles.options}>
            <label
              className={`${styles.option} ${format === "gpg" ? styles.optionActive : ""}`}
            >
              <input
                checked={format === "gpg"}
                className={styles.radio}
                name="signing-format"
                type="radio"
                onChange={() => updateFormat("gpg")}
              />
              <span>GPG</span>
            </label>
            <label
              className={`${styles.option} ${format === "ssh" ? styles.optionActive : ""}`}
            >
              <input
                checked={format === "ssh"}
                className={styles.radio}
                name="signing-format"
                type="radio"
                onChange={() => updateFormat("ssh")}
              />
              <span>SSH</span>
            </label>
          </div>
        </SettingsScreenField>

        <SettingsScreenField label="Signing key (user.signingkey)">
          <div className={styles.editorForm}>
            <Input
              mono
              placeholder="key ID, fingerprint, or path"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <div className={styles.editorFormActions}>
              <Button
                disabled={keyDraft === signingKey}
                variant="primary"
                onClick={saveKey}
              >
                Save
              </Button>
            </div>
          </div>
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

const UPDATER_CHANNEL_LABELS: Record<"beta" | "latest", string> = {
  latest: "Production",
  beta: "Beta",
};

const UPDATER_CHANNELS: ("beta" | "latest")[] = ["latest", "beta"];

function AdvancedSection() {
  const [channel, setChannel] = useState<"beta" | "latest">("latest");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        // Tolerate legacy "alpha" values from earlier builds — alpha is no
        // longer subscribable in-app, so collapse it to "latest" on display.
        const stored = settings.updater_channel;
        setChannel(stored === "beta" ? "beta" : "latest");
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (next: "beta" | "latest") => {
    setChannel(next);
    try {
      const current = await getAppSettings();
      await setAppSettings({ ...current, updater_channel: next });
    } catch {
      // ignore — local state already reflects the user's choice
    }
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Auto-updater feed. Leave on Production for stable releases. Switch to Beta to receive in-development builds of upcoming features — Beta builds should work, but they may contain bugs that haven't surfaced yet. The change takes effect after the next app restart."
        title="Update channel"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="Channel">
          <div className={styles.options}>
            {UPDATER_CHANNELS.map((c) => (
              <label
                key={c}
                className={`${styles.option} ${channel === c ? styles.optionActive : ""}`}
              >
                <input
                  checked={channel === c}
                  className={styles.radio}
                  disabled={!loaded}
                  name="updater-channel"
                  type="radio"
                  value={c}
                  onChange={() => handleChange(c).catch(() => undefined)}
                />
                <span>{UPDATER_CHANNEL_LABELS[c]}</span>
              </label>
            ))}
          </div>
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
