import type {
  BrowserPresetConfig,
  RuntimePlatform,
  ArgusConfig,
  WorkspaceEnvConfig,
} from "../../../lib/types";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Icons,
  Input,
  SettingsDialogShell,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  TextArea,
  type SettingsDialogGroup,
} from "@argus/peacock";
import {
  getUserProjectSettings,
  readArgusConfig,
  setUserProjectSettings,
  writeArgusConfig,
} from "../../../lib/ipc";
import { dialogStyles as styles } from "../../shared/Dialog";
import {
  InheritedMcpList,
  McpServersField,
  entriesToMap,
  entriesValid,
  mapToEntries,
  type McpEntry,
} from "../../shared/McpServersField";
import { ReleaseNotesField } from "./ReleaseNotesField";
import sectionStyles from "./SetupConfigDialog.module.css";
import {
  entriesToPatternConfig,
  patternsToEntries,
  useReleaseNotesListState,
} from "./releaseNotesFieldState";

interface SetupConfigDialogProps {
  onClose: () => void;
  onSaved?: () => void;
  repoRoot: string;
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function platformLabel(p: string): string {
  if (p === "ios") {
    return "iOS";
  }
  if (p === "android") {
    return "Android";
  }
  if (p === "tvos") {
    return "tvOS";
  }

  return "Web";
}

function useListState(initial: string[]) {
  const [items, setItems] = useState<string[]>(initial);
  const add = () => setItems((prev) => [...prev, ""]);
  const update = (i: number, val: string) =>
    setItems((prev) => prev.map((v, idx) => (idx === i ? val : v)));
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  return { items, setItems, add, update, remove };
}

interface TerminalEntry {
  dir: string;
  name: string;
}

function useTerminalListState(initial: TerminalEntry[]) {
  const [items, setItems] = useState<TerminalEntry[]>(initial);
  const add = () => setItems((prev) => [...prev, { name: "", dir: "" }]);
  const update = (i: number, field: keyof TerminalEntry, val: string) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry,
      ),
    );
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  return { items, setItems, add, update, remove };
}

interface EnvEntry {
  base_value: string;
  name: string;
  range: string;
  strategy: "hash" | "sequential";
}

function useEnvListState(initial: EnvEntry[]) {
  const [items, setItems] = useState<EnvEntry[]>(initial);
  const add = () =>
    setItems((prev) => [
      ...prev,
      { name: "", base_value: "", range: "", strategy: "hash" },
    ]);
  const update = (i: number, field: keyof EnvEntry, val: string) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry,
      ),
    );
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  return { items, setItems, add, update, remove };
}

interface RunEntry {
  command: string;
  cwd: string;
  requires: string[];
  restartOnRerun: boolean;
  title: string;
}

function useRunListState(initial: RunEntry[]) {
  const [items, setItems] = useState<RunEntry[]>(initial);
  const add = () =>
    setItems((prev) => [
      ...prev,
      {
        title: "",
        command: "",
        cwd: "",
        restartOnRerun: false,
        requires: [],
      },
    ]);
  const update = <K extends keyof RunEntry>(
    i: number,
    field: K,
    val: RunEntry[K],
  ) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry,
      ),
    );
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  return { items, setItems, add, update, remove };
}

interface BrowserPresetEntry {
  height: string;
  id: string;
  label: string;
  user_agent: string;
  width: string;
}

function useBrowserPresetListState(initial: BrowserPresetEntry[]) {
  const [items, setItems] = useState<BrowserPresetEntry[]>(initial);
  const add = () =>
    setItems((prev) => [
      ...prev,
      { id: "", label: "", width: "", height: "", user_agent: "" },
    ]);
  const update = (i: number, field: keyof BrowserPresetEntry, val: string) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry,
      ),
    );
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  return { items, setItems, add, update, remove };
}

/* ------------------------------------------------------------------ */
/*  Reusable field sub-components                                      */
/* ------------------------------------------------------------------ */

interface ListFieldProps {
  emptyLabel: string;
  label: string;
  list: ReturnType<typeof useListState>;
  placeholder: string;
}

function ListField({ label, placeholder, emptyLabel, list }: ListFieldProps) {
  const handleListAdd = list.add;

  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>{label}</p>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>{emptyLabel}</span>
          <button className={styles.addRowBtn} onClick={handleListAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((item, i) => (
            <div key={i} className={styles.listRow}>
              <Input
                placeholder={placeholder}
                type="text"
                value={item}
                onChange={(e) => list.update(i, e.target.value)}
              />
              <button
                aria-label="Remove"
                className={styles.removeBtn}
                onClick={() => list.remove(i)}
              >
                <Icons.CloseIcon size={12} />
              </button>
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={handleListAdd}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

function TerminalField({
  list,
}: {
  list: ReturnType<typeof useTerminalListState>;
}) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No terminals configured</span>
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i} className={styles.listRow}>
              <Input
                placeholder="Name (e.g. Frontend)"
                style={{ flex: 1 }}
                type="text"
                value={entry.name}
                onChange={(e) => list.update(i, "name", e.target.value)}
              />
              <Input
                placeholder="Dir (e.g. packages/web)"
                style={{ flex: 1 }}
                type="text"
                value={entry.dir}
                onChange={(e) => list.update(i, "dir", e.target.value)}
              />
              <button
                aria-label="Remove"
                className={styles.removeBtn}
                onClick={() => list.remove(i)}
              >
                <Icons.CloseIcon size={12} />
              </button>
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

function RunCommandsField({
  list,
}: {
  list: ReturnType<typeof useRunListState>;
}) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No run commands configured</span>
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={sectionStyles.runCommandList}>
          {list.items.map((entry, i) => {
            const otherTitles = list.items
              .map((e, idx) => ({ title: e.title.trim(), idx }))
              .filter((e) => e.idx !== i && e.title.length > 0);
            const toggleRequires = (req: string, checked: boolean) => {
              const next = checked
                ? [...entry.requires, req]
                : entry.requires.filter((r) => r !== req);
              list.update(i, "requires", next);
            };

            return (
              <div key={i} className={sectionStyles.runCommandCard}>
                <div className={sectionStyles.runCommandTopRow}>
                  <Input
                    placeholder="Title (e.g. Dev)"
                    style={{ flex: 1, minWidth: 100 }}
                    type="text"
                    value={entry.title}
                    onChange={(e) => list.update(i, "title", e.target.value)}
                  />
                  <Input
                    placeholder="Command (e.g. pnpm dev)"
                    style={{ flex: 2, minWidth: 160 }}
                    type="text"
                    value={entry.command}
                    onChange={(e) => list.update(i, "command", e.target.value)}
                  />
                  <Input
                    placeholder="cwd (optional)"
                    style={{ flex: 1, minWidth: 100 }}
                    type="text"
                    value={entry.cwd}
                    onChange={(e) => list.update(i, "cwd", e.target.value)}
                  />
                  <label className={styles.checkboxRow}>
                    <input
                      checked={entry.restartOnRerun}
                      type="checkbox"
                      onChange={(e) =>
                        list.update(i, "restartOnRerun", e.target.checked)
                      }
                    />
                    Restart on rerun
                  </label>
                  <button
                    aria-label="Remove"
                    className={styles.removeBtn}
                    onClick={() => list.remove(i)}
                  >
                    <Icons.CloseIcon size={12} />
                  </button>
                </div>
                {otherTitles.length > 0 && (
                  <div className={sectionStyles.runCommandRequiresRow}>
                    <span className={sectionStyles.runCommandRequiresLabel}>
                      Requires running
                    </span>
                    {otherTitles.map((o) => (
                      <label key={o.idx} className={styles.checkboxRow}>
                        <input
                          checked={entry.requires.includes(o.title)}
                          type="checkbox"
                          onChange={(e) =>
                            toggleRequires(o.title, e.target.checked)
                          }
                        />
                        {o.title}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      )}
      <p className={styles.helpText}>
        Shown in the app&apos;s run menu. Title identifies each entry; enable
        &quot;Restart on rerun&quot; to kill an existing session before starting
        a new one. Use &quot;Requires running&quot; to declare dependencies on
        other commands (e.g. a frontend that needs the backend up first) — Argus
        will start any that aren&apos;t already running.
      </p>
    </div>
  );
}

function EnvField({ list }: { list: ReturnType<typeof useEnvListState> }) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No env variables configured</span>
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i}>
              <div className={styles.envGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>Env var name</label>
                  <Input
                    placeholder="e.g. ARGUS_PORT"
                    type="text"
                    value={entry.name}
                    onChange={(e) => list.update(i, "name", e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Strategy</label>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <select
                      className={styles.input}
                      style={{ flex: 1 }}
                      value={entry.strategy}
                      onChange={(e) =>
                        list.update(i, "strategy", e.target.value)
                      }
                    >
                      <option value="hash">Hash</option>
                      <option value="sequential">Sequential</option>
                    </select>
                    <button
                      aria-label="Remove env variable"
                      className={styles.removeBtn}
                      onClick={() => list.remove(i)}
                    >
                      <Icons.CloseIcon size={12} />
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Base value</label>
                  <Input
                    placeholder="8081"
                    type="text"
                    value={entry.base_value}
                    onChange={(e) =>
                      list.update(i, "base_value", e.target.value)
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Range</label>
                  <Input
                    placeholder="1000"
                    type="text"
                    value={entry.range}
                    onChange={(e) => list.update(i, "range", e.target.value)}
                  />
                </div>
              </div>
              {i < list.items.length - 1 && (
                <hr
                  style={{
                    border: "none",
                    borderTop: "1px solid var(--border-subtle)",
                    margin: "10px 0",
                  }}
                />
              )}
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      )}
      <p className={styles.helpText}>
        Unique integer per session for port allocation. Hash: base_value + hash
        % range. Sequential: base_value + index.
      </p>
    </div>
  );
}

function BrowserPresetField({
  list,
}: {
  list: ReturnType<typeof useBrowserPresetListState>;
}) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No custom presets</span>
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i}>
              <div className={styles.envGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>ID</label>
                  <Input
                    placeholder="e.g. iphone-15-pro"
                    type="text"
                    value={entry.id}
                    onChange={(e) => list.update(i, "id", e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Label</label>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <Input
                      placeholder="e.g. iPhone 15 Pro"
                      style={{ flex: 1 }}
                      type="text"
                      value={entry.label}
                      onChange={(e) => list.update(i, "label", e.target.value)}
                    />
                    <button
                      aria-label="Remove preset"
                      className={styles.removeBtn}
                      onClick={() => list.remove(i)}
                    >
                      <Icons.CloseIcon size={12} />
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Width</label>
                  <Input
                    placeholder="393"
                    type="text"
                    value={entry.width}
                    onChange={(e) => list.update(i, "width", e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Height</label>
                  <Input
                    placeholder="852"
                    type="text"
                    value={entry.height}
                    onChange={(e) => list.update(i, "height", e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.field} style={{ marginTop: 4 }}>
                <label className={styles.label}>User Agent (optional)</label>
                <Input
                  placeholder="Defaults to desktop Chrome UA"
                  type="text"
                  value={entry.user_agent}
                  onChange={(e) => list.update(i, "user_agent", e.target.value)}
                />
              </div>
              {i < list.items.length - 1 && (
                <hr
                  style={{
                    border: "none",
                    borderTop: "1px solid var(--border-subtle)",
                    margin: "10px 0",
                  }}
                />
              )}
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={handleAdd}>
            + Add
          </button>
        </div>
      )}
      <p className={styles.helpText}>
        Custom device presets for the web browser panel. Width and height are
        CSS pixels.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main dialog                                                        */
/* ------------------------------------------------------------------ */

export function SetupConfigDialog({
  repoRoot,
  onClose,
  onSaved,
}: SetupConfigDialogProps) {
  const copyList = useListState([]);
  const symlinkList = useListState([]);
  const commandList = useListState([]);
  const terminalList = useTerminalListState([]);
  const envList = useEnvListState([]);
  const browserPresetList = useBrowserPresetListState([]);
  const runList = useRunListState([]);
  const protectedBranchList = useListState([]);
  const releaseNotesList = useReleaseNotesListState([]);
  const [browserUrl, setBrowserUrl] = useState("");
  const [platforms, setPlatforms] = useState<RuntimePlatform[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [saveChatHistory, setSaveChatHistory] = useState(true);
  const [singleRuntime, setSingleRuntime] = useState(false);
  const [pullRequestTemplate, setPullRequestTemplate] = useState("");
  const [minArgusVersion, setMinArgusVersion] = useState("");
  const [mcpEntries, setMcpEntries] = useState<McpEntry[]>([]);
  const [branchPrefix, setBranchPrefix] = useState("");
  const [initialBranchPrefix, setInitialBranchPrefix] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setCopies = copyList.setItems;
  const setSymlinks = symlinkList.setItems;
  const setCommands = commandList.setItems;
  const setTerminals = terminalList.setItems;
  const setEnvs = envList.setItems;
  const setBrowserPresets = browserPresetList.setItems;
  const setRuns = runList.setItems;
  const setProtectedBranches = protectedBranchList.setItems;
  const setReleaseNotes = releaseNotesList.setItems;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await readArgusConfig(repoRoot);
        if (cancelled) {
          return;
        }
        if (config.setup?.copy?.length) {
          setCopies(config.setup.copy);
        }
        if (config.setup?.symlink?.length) {
          setSymlinks(config.setup.symlink);
        }
        if (config.setup?.commands?.length) {
          setCommands(config.setup.commands);
        }
        if (config.terminals?.length) {
          setTerminals(
            config.terminals.map((t) => ({
              name: t.name ?? "",
              dir: t.dir ?? "",
            })),
          );
        }
        if (config.run?.length) {
          setRuns(
            config.run.map((r) => ({
              title: r.title ?? "",
              command: r.command ?? "",
              cwd: r.cwd ?? "",
              restartOnRerun: Boolean(r.restartOnRerun),
              requires: Array.isArray(r.requires) ? [...r.requires] : [],
            })),
          );
        }
        if (config.agent_prompt) {
          setAgentPrompt(config.agent_prompt);
        }
        if (config.save_chat_history != null) {
          setSaveChatHistory(config.save_chat_history !== false);
        }
        if (config.single_runtime) {
          setSingleRuntime(true);
        }
        if (config.browser_url) {
          setBrowserUrl(config.browser_url);
        }
        if (config.platforms?.length) {
          setPlatforms(
            config.platforms.filter(
              (p): p is RuntimePlatform =>
                p === "ios" || p === "android" || p === "tvos" || p === "web",
            ),
          );
        }
        if (config.workspace_env?.length) {
          setEnvs(
            config.workspace_env.map((we: WorkspaceEnvConfig) => ({
              name: we.name ?? "",
              base_value: we.base_value != null ? String(we.base_value) : "",
              range: we.range != null ? String(we.range) : "",
              strategy: we.strategy ?? "hash",
            })),
          );
        }
        if (config.browser_presets?.length) {
          setBrowserPresets(
            config.browser_presets.map((bp: BrowserPresetConfig) => ({
              id: bp.id ?? "",
              label: bp.label ?? "",
              width: bp.width != null ? String(bp.width) : "",
              height: bp.height != null ? String(bp.height) : "",
              user_agent: bp.user_agent ?? "",
            })),
          );
        }
        if (config.protected_branches?.length) {
          setProtectedBranches(config.protected_branches);
        }
        if (config.pull_request_template) {
          setPullRequestTemplate(config.pull_request_template);
        }
        if (config.min_argus_version) {
          setMinArgusVersion(config.min_argus_version);
        }
        if (config.mcp_servers) {
          setMcpEntries(mapToEntries(config.mcp_servers));
        }
        if (config.release_note_patterns?.length) {
          setReleaseNotes(patternsToEntries(config.release_note_patterns));
        }
      } catch {
        // No config file or not readable — start with empty fields
      }

      try {
        const personal = await getUserProjectSettings(repoRoot);
        if (cancelled) {
          return;
        }
        const prefix = personal.branch_prefix ?? "";
        setBranchPrefix(prefix);
        setInitialBranchPrefix(prefix);
      } catch {
        // No personal settings yet — leave blank.
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    repoRoot,
    setCopies,
    setSymlinks,
    setCommands,
    setTerminals,
    setEnvs,
    setBrowserPresets,
    setRuns,
    setProtectedBranches,
    setReleaseNotes,
  ]);

  const buildConfig = (): ArgusConfig => {
    const config: ArgusConfig = { setup: {} };
    const copies = copyList.items.filter(Boolean);
    const symlinks = symlinkList.items.filter(Boolean);
    const commands = commandList.items.filter(Boolean);
    if (copies.length) {
      config.setup!.copy = copies;
    }
    if (symlinks.length) {
      config.setup!.symlink = symlinks;
    }
    if (commands.length) {
      config.setup!.commands = commands;
    }
    const terminals = terminalList.items.filter((t) => t.name || t.dir);
    if (terminals.length) {
      config.terminals = terminals;
    }
    const runs = runList.items
      .filter((r) => r.title.trim() && r.command.trim())
      .map((r) => {
        const requires = r.requires.map((s) => s.trim()).filter(Boolean);

        return {
          title: r.title.trim(),
          command: r.command.trim(),
          ...(r.cwd.trim() ? { cwd: r.cwd.trim() } : {}),
          restartOnRerun: r.restartOnRerun,
          ...(requires.length > 0 ? { requires } : {}),
        };
      });
    if (runs.length) {
      config.run = runs;
    }

    const agentPromptVal = agentPrompt.trim();
    if (agentPromptVal) {
      config.agent_prompt = agentPromptVal;
    }
    if (!saveChatHistory) {
      config.save_chat_history = false;
    }
    const browserUrlVal = browserUrl.trim();
    if (browserUrlVal) {
      config.browser_url = browserUrlVal;
    }
    if (platforms.length) {
      config.platforms = platforms;
    }
    if (singleRuntime) {
      config.single_runtime = true;
    }
    const envVars = envList.items
      .filter((e) => e.name.trim())
      .map((e) => {
        const baseValue = parseInt(e.base_value.trim(), 10);
        const range = parseInt(e.range.trim(), 10);

        return {
          name: e.name.trim(),
          base_value:
            !Number.isNaN(baseValue) && baseValue >= 0 ? baseValue : 8081,
          ...(!Number.isNaN(range) && range > 0 ? { range } : {}),
          ...(e.strategy !== "hash" ? { strategy: e.strategy } : {}),
        };
      });
    if (envVars.length) {
      config.workspace_env = envVars;
    }
    const presets = browserPresetList.items
      .filter((p) => p.id.trim())
      .map((p) => {
        const width = parseInt(p.width.trim(), 10);
        const height = parseInt(p.height.trim(), 10);

        return {
          id: p.id.trim(),
          ...(p.label.trim() ? { label: p.label.trim() } : {}),
          width: !Number.isNaN(width) && width > 0 ? width : 375,
          height: !Number.isNaN(height) && height > 0 ? height : 667,
          ...(p.user_agent.trim() ? { user_agent: p.user_agent.trim() } : {}),
        };
      });
    if (presets.length) {
      config.browser_presets = presets;
    }
    const protectedBranches = protectedBranchList.items.filter(Boolean);
    if (protectedBranches.length) {
      config.protected_branches = protectedBranches;
    }
    const prTemplate = pullRequestTemplate.trim();
    if (prTemplate) {
      config.pull_request_template = prTemplate;
    }
    const minVersion = minArgusVersion.trim().replace(/^v/i, "");
    if (minVersion) {
      config.min_argus_version = minVersion;
    }
    const mcpServers = entriesToMap(mcpEntries);
    if (Object.keys(mcpServers).length > 0) {
      config.mcp_servers = mcpServers;
    }
    const releasePatterns = entriesToPatternConfig(releaseNotesList.items);
    if (releasePatterns.length > 0) {
      config.release_note_patterns = releasePatterns;
    }

    return config;
  };

  const previewJson = useMemo(
    () => JSON.stringify(buildConfig(), null, 2),
    // buildConfig closes over every piece of state — recompute on any change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      copyList.items,
      symlinkList.items,
      commandList.items,
      terminalList.items,
      runList.items,
      envList.items,
      browserPresetList.items,
      protectedBranchList.items,
      browserUrl,
      platforms,
      agentPrompt,
      saveChatHistory,
      singleRuntime,
      pullRequestTemplate,
      minArgusVersion,
      mcpEntries,
      releaseNotesList.items,
    ],
  );

  const handleSave = async () => {
    if (!repoRoot) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await writeArgusConfig(repoRoot, previewJson);
      const trimmedPrefix = branchPrefix.trim();
      if (trimmedPrefix !== initialBranchPrefix) {
        await setUserProjectSettings(repoRoot, {
          branch_prefix: trimmedPrefix,
        });
        setInitialBranchPrefix(trimmedPrefix);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setIsSaving(false);
    }
  };

  const groups: SettingsDialogGroup[] = [
    {
      label: "Workspace",
      sections: [
        {
          id: "setup",
          label: "Setup",
          description: "Copy, symlink, commands",
          icon: <Icons.FolderIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="What happens once when a worktree session is created. Order: copy → symlink → commands."
                title="Session setup"
              />
              <SettingsScreenDetailBody>
                <ListField
                  emptyLabel="No copy patterns"
                  label="Copy"
                  list={copyList}
                  placeholder="path/to/dir or *.env (glob)"
                />
                <ListField
                  emptyLabel="No symlink patterns"
                  label="Symlink"
                  list={symlinkList}
                  placeholder="path/to/file or **/.env.local (glob)"
                />
                <ListField
                  emptyLabel="No setup commands"
                  label="Commands"
                  list={commandList}
                  placeholder="npm install"
                />
                <div className={styles.field}>
                  <label
                    className={styles.label}
                    htmlFor="setup-min-argus-version"
                  >
                    Minimum Argus version
                  </label>
                  <Input
                    id="setup-min-argus-version"
                    placeholder="0.10.0"
                    type="text"
                    value={minArgusVersion}
                    onChange={(e) => setMinArgusVersion(e.target.value)}
                  />
                  <p className={styles.helpText}>
                    Optional. Semver string. The project home screen warns
                    teammates running an older Argus build.
                  </p>
                </div>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "platforms",
          label: "Platforms",
          description: "iOS / Android / tvOS / Web",
          icon: <Icons.SimulatorIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Runtimes the agent system prompt describes. Leave empty to describe iOS, Android, and Web — narrow this so agents only see platforms this project actually targets. Devices are still acquired lazily when agents run conductor commands."
                title="Target platforms"
              />
              <SettingsScreenDetailBody>
                <div className={styles.field}>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {(["ios", "android", "tvos", "web"] as const).map((p) => (
                      <label key={p} className={styles.checkboxRow}>
                        <input
                          checked={platforms.includes(p)}
                          type="checkbox"
                          onChange={(e) =>
                            setPlatforms((prev) =>
                              e.target.checked
                                ? [...prev, p]
                                : prev.filter((x) => x !== p),
                            )
                          }
                        />
                        {platformLabel(p)}
                      </label>
                    ))}
                  </div>
                </div>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "workspace-env",
          label: "Workspace env",
          description: "Per-session vars",
          icon: <Icons.GearIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Env vars set in every terminal and run command of a session, with a value unique to that session. Useful for port allocation."
                title="Workspace environment"
              />
              <SettingsScreenDetailBody>
                <EnvField list={envList} />
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
      ],
    },
    {
      label: "Runtime",
      sections: [
        {
          id: "run",
          label: "Run commands",
          description: "Dev, Storybook, …",
          icon: <Icons.PlayIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Entries shown in the run menu. Argus tracks each running command per session."
                title="Run commands"
              />
              <SettingsScreenDetailBody>
                <RunCommandsField list={runList} />
                <div className={styles.field}>
                  <label className={styles.checkboxRow}>
                    <input
                      checked={singleRuntime}
                      type="checkbox"
                      onChange={(e) => setSingleRuntime(e.target.checked)}
                    />
                    Only one runtime active at a time across this project
                  </label>
                  <p className={styles.helpText}>
                    When enabled, starting a run command prompts you to stop any
                    runtime already active in another session of this project.
                    Useful when the dev server binds a fixed port or device that
                    can&apos;t be shared.
                  </p>
                </div>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "terminals",
          label: "Terminals",
          description: "Auto-opened tabs",
          icon: <Icons.TerminalIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Terminal tabs that auto-open in the bottom panel when a session is selected."
                title="Terminals"
              />
              <SettingsScreenDetailBody>
                <TerminalField list={terminalList} />
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "browser",
          label: "Browser",
          description: "URL & device presets",
          icon: <Icons.WebIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="The web runtime panel loads this URL on first open and exposes the device presets in its picker."
                title="Browser"
              />
              <SettingsScreenDetailBody>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="setup-browser-url">
                    Default browser URL
                  </label>
                  <Input
                    autoComplete="url"
                    id="setup-browser-url"
                    placeholder="http://localhost:3000"
                    type="text"
                    value={browserUrl}
                    onChange={(e) => setBrowserUrl(e.target.value)}
                  />
                </div>
                <BrowserPresetField list={browserPresetList} />
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
      ],
    },
    {
      label: "Workflow",
      sections: [
        {
          id: "branch-protection",
          label: "Branch protection",
          description: "Protected branches",
          icon: <Icons.BranchIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Sessions whose base branch matches a protected branch are merged through a pull request instead of a direct merge."
                title="Branch protection"
              />
              <SettingsScreenDetailBody>
                <ListField
                  emptyLabel="No protected branches"
                  label="Protected branches"
                  list={protectedBranchList}
                  placeholder="main"
                />

                <details className={sectionStyles.advanced}>
                  <summary className={sectionStyles.advancedSummary}>
                    Advanced
                  </summary>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="setup-pr-template">
                      Preferred PR template filename
                    </label>
                    <Input
                      id="setup-pr-template"
                      placeholder="feature.md"
                      type="text"
                      value={pullRequestTemplate}
                      onChange={(e) => setPullRequestTemplate(e.target.value)}
                    />
                    <p className={styles.helpText}>
                      Only relevant when the repo has multiple PR templates
                      under <code>.github/PULL_REQUEST_TEMPLATE/</code>. For the
                      common single-template case GitHub auto-applies the file
                      and this field does nothing.
                    </p>
                  </div>
                </details>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "release-notes",
          label: "Release notes",
          description: "Glob patterns + labels",
          icon: <Icons.FileIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Glob patterns surfaced on the session home screen as release notes. Pick a format per pattern (changesets / regex / json / yaml / xml). The preview shows every file in the repo currently matching your globs so you can verify the config — only files added or modified on a session branch are listed at runtime."
                title="Release notes"
              />
              <SettingsScreenDetailBody>
                <ReleaseNotesField
                  list={releaseNotesList}
                  repoRoot={repoRoot}
                />
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "agent",
          label: "Agent",
          description: "Prompt & history",
          icon: <Icons.AgentIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Configuration for Claude agents working in this project."
                title="Agent"
              />
              <SettingsScreenDetailBody>
                <div className={styles.field}>
                  <p className={styles.sectionTitle}>System prompt</p>
                  <TextArea
                    placeholder="Additional instructions appended to every agent's system prompt..."
                    rows={6}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                  />
                  <p className={styles.helpText}>
                    Appended to every agent&apos;s system prompt in this
                    project.
                  </p>
                </div>
                <div className={styles.field}>
                  <label className={styles.checkboxRow}>
                    <input
                      checked={saveChatHistory}
                      type="checkbox"
                      onChange={(e) => setSaveChatHistory(e.target.checked)}
                    />
                    Save chat history when agents stop
                  </label>
                </div>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "mcp",
          label: "MCP servers",
          description: "Project-level servers",
          icon: <Icons.GearIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="MCP servers shared with the team via .argus.json. Merged on top of plugin servers, ~/.claude.json, .mcp.json, and your personal app-level servers."
                title="Project MCP servers"
              />
              <SettingsScreenDetailBody>
                <InheritedMcpList worktreePath={repoRoot} />
                <McpServersField
                  emptyLabel="No project MCP servers"
                  entries={mcpEntries}
                  onChange={setMcpEntries}
                />
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
      ],
    },
    {
      label: "Personal",
      sections: [
        {
          id: "branch-prefix",
          label: "Branch prefix",
          description: "Local to this machine",
          icon: <Icons.BranchIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Prepended to every new branch you create in this project. Stored in ~/.argus/user-project-settings.json — not in .argus.json — so it stays personal and is not shared with the team."
                title="Personal branch prefix"
              />
              <SettingsScreenDetailBody>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="setup-branch-prefix">
                    Branch prefix
                  </label>
                  <Input
                    id="setup-branch-prefix"
                    placeholder="douwe/"
                    type="text"
                    value={branchPrefix}
                    onChange={(e) => setBranchPrefix(e.target.value)}
                  />
                  <p className={styles.helpText}>
                    Example: <code>douwe/</code> turns a branch name like{" "}
                    <code>fix-login</code> into <code>douwe/fix-login</code>.
                    Leave empty to disable. You can also edit this inline from
                    the Create Session dialog.
                  </p>
                </div>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
      ],
    },
    {
      label: "Reference",
      sections: [
        {
          id: "preview",
          label: "JSON preview",
          description: "Generated .argus.json",
          icon: <Icons.FileIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Read-only view of what will be written to .argus.json on save."
                title="JSON preview"
              />
              <SettingsScreenDetailBody>
                <pre className={styles.preview}>{previewJson}</pre>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
      ],
    },
  ];

  const footer = (
    <>
      {error && (
        <div className={sectionStyles.errorBar}>
          <p className={styles.errorMsg}>{error}</p>
        </div>
      )}
      <div className={styles.stickyFooter}>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={
            isSaving || isLoading || !repoRoot || !entriesValid(mcpEntries)
          }
          type="button"
          variant="primary"
          onClick={handleSave}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </>
  );

  return (
    <SettingsDialogShell
      footer={footer}
      groups={groups}
      title="Project settings"
      titleId="setup-cfg-title"
      onClose={onClose}
    />
  );
}
