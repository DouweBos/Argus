import type {
  BrowserPresetConfig,
  RuntimePlatform,
  StagehandConfig,
  WorkspaceEnvConfig,
} from "../../../lib/types";
import { useEffect, useState } from "react";
import { useOverlayDismiss } from "../../../hooks/useOverlayDismiss";
import { readStagehandConfig, writeStagehandConfig } from "../../../lib/ipc";
import { ChevronRightIcon, CloseIcon } from "../../shared/Icons";
import styles from "../Dialog/Dialog.module.css";

interface SetupConfigDialogProps {
  onClose: () => void;
  onSaved?: () => void;
  repoRoot: string;
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

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
/*  ConfigSection — collapsible group                                  */
/* ------------------------------------------------------------------ */

interface ConfigSectionProps {
  children: React.ReactNode;
  defaultOpen: boolean;
  description: string;
  summary: string;
  title: string;
}

function ConfigSection({
  title,
  summary,
  description,
  defaultOpen,
  children,
}: ConfigSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.configSection}>
      <button
        className={styles.configSectionHeader}
        type="button"
        onClick={() => setOpen((p) => !p)}
      >
        <ChevronRightIcon
          className={`${styles.configSectionChevron} ${open ? styles.configSectionChevronExpanded : ""}`}
        />
        <span className={styles.configSectionTitle}>{title}</span>
        {!open && summary && (
          <span className={styles.configSectionSummary}>{summary}</span>
        )}
      </button>
      {open && (
        <div className={styles.configSectionBody}>
          <p className={styles.configSectionDesc}>{description}</p>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
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
              <input
                className={styles.input}
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
                <CloseIcon />
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

interface TerminalFieldProps {
  list: ReturnType<typeof useTerminalListState>;
}

function TerminalField({ list }: TerminalFieldProps) {
  const handleTerminalListAdd = list.add;

  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>Auto-open Terminals</p>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No terminals configured</span>
          <button className={styles.addRowBtn} onClick={handleTerminalListAdd}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i} className={styles.listRow}>
              <input
                className={styles.input}
                placeholder="Name (e.g. Frontend)"
                style={{ flex: 1 }}
                type="text"
                value={entry.name}
                onChange={(e) => list.update(i, "name", e.target.value)}
              />
              <input
                className={styles.input}
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
                <CloseIcon />
              </button>
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={handleTerminalListAdd}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

interface EnvFieldProps {
  list: ReturnType<typeof useEnvListState>;
}

function EnvField({ list }: EnvFieldProps) {
  const handleEnvListAdd = list.add;

  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>Workspace Environment Variables</p>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No env variables configured</span>
          <button className={styles.addRowBtn} onClick={handleEnvListAdd}>
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
                  <input
                    className={styles.input}
                    placeholder="e.g. STAGEHAND_PORT"
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
                      <CloseIcon />
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Base value</label>
                  <input
                    className={styles.input}
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
                  <input
                    className={styles.input}
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
          <button className={styles.addRowBtn} onClick={handleEnvListAdd}>
            + Add
          </button>
        </div>
      )}
      <p className={styles.helpText}>
        Unique integer per workspace for port allocation. Hash: base_value +
        hash % range. Sequential: base_value + index.
      </p>
    </div>
  );
}

interface BrowserPresetFieldProps {
  list: ReturnType<typeof useBrowserPresetListState>;
}

function BrowserPresetField({ list }: BrowserPresetFieldProps) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>Browser Device Presets</p>
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
                  <input
                    className={styles.input}
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
                    <input
                      className={styles.input}
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
                      <CloseIcon />
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Width</label>
                  <input
                    className={styles.input}
                    placeholder="393"
                    type="text"
                    value={entry.width}
                    onChange={(e) => list.update(i, "width", e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Height</label>
                  <input
                    className={styles.input}
                    placeholder="852"
                    type="text"
                    value={entry.height}
                    onChange={(e) => list.update(i, "height", e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.field} style={{ marginTop: 4 }}>
                <label className={styles.label}>User Agent (optional)</label>
                <input
                  className={styles.input}
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
/*  Summary helpers                                                    */
/* ------------------------------------------------------------------ */

function setupSummary(
  copy: string[],
  symlink: string[],
  commands: string[],
): string {
  const parts: string[] = [];
  const c = copy.filter(Boolean).length;
  const s = symlink.filter(Boolean).length;
  const cmd = commands.filter(Boolean).length;
  if (c) {
    parts.push(`${c} copy`);
  }
  if (s) {
    parts.push(`${s} symlink`);
  }
  if (cmd) {
    parts.push(`${cmd} command${cmd > 1 ? "s" : ""}`);
  }

  return parts.join(", ");
}

function runtimeSummary(
  runCommand: string,
  browserUrl: string,
  terminals: TerminalEntry[],
  envEntries: EnvEntry[],
  browserPresets: BrowserPresetEntry[],
  platforms: RuntimePlatform[],
): string {
  const parts: string[] = [];
  if (platforms.length) {
    parts.push(platforms.join("+"));
  }
  if (runCommand.trim()) {
    parts.push(runCommand.trim());
  }
  const bu = browserUrl.trim();
  if (bu) {
    parts.push(bu.length > 40 ? bu.slice(0, 40) + "…" : bu);
  }
  const bp = browserPresets.filter((p) => p.id.trim()).length;
  if (bp) {
    parts.push(`${bp} preset${bp > 1 ? "s" : ""}`);
  }
  const t = terminals.filter((e) => e.name || e.dir).length;
  if (t) {
    parts.push(`${t} terminal${t > 1 ? "s" : ""}`);
  }
  const e = envEntries.filter((v) => v.name.trim()).length;
  if (e) {
    parts.push(`${e} env var${e > 1 ? "s" : ""}`);
  }

  return parts.join(", ");
}

function agentSummary(prompt: string, saveChatHistory: boolean): string {
  const parts: string[] = [];
  const trimmed = prompt.trim();
  if (trimmed) {
    parts.push(trimmed.length > 40 ? trimmed.slice(0, 40) + "..." : trimmed);
  }
  if (!saveChatHistory) {
    parts.push("history off");
  }

  return parts.join(", ");
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
  const [runCommand, setRunCommand] = useState("");
  const [runDir, setRunDir] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");
  const [platforms, setPlatforms] = useState<RuntimePlatform[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [saveChatHistory, setSaveChatHistory] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const setCopies = copyList.setItems;
  const setSymlinks = symlinkList.setItems;
  const setCommands = commandList.setItems;
  const setTerminals = terminalList.setItems;
  const setEnvs = envList.setItems;
  const setBrowserPresets = browserPresetList.setItems;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await readStagehandConfig(repoRoot);
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

        if (config.run) {
          if (typeof config.run === "string") {
            setRunCommand(config.run);
          } else {
            setRunCommand(config.run.command);
            if (config.run.dir) {
              setRunDir(config.run.dir);
            }
          }
        }

        if (config.agent_prompt) {
          setAgentPrompt(config.agent_prompt);
        }
        if (config.save_chat_history != null) {
          setSaveChatHistory(config.save_chat_history !== false);
        }
        if (config.browser_url) {
          setBrowserUrl(config.browser_url);
        }
        if (config.platforms?.length) {
          setPlatforms(
            config.platforms.filter(
              (p): p is RuntimePlatform =>
                p === "ios" || p === "android" || p === "web",
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
      } catch {
        // No config file or not readable — start with empty fields
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
  ]);

  const buildConfig = (): StagehandConfig => {
    const config: StagehandConfig = { setup: {} };
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
    const run = runCommand.trim();
    const runDirVal = runDir.trim();
    if (run) {
      config.run = runDirVal ? { command: run, dir: runDirVal } : run;
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

    return config;
  };

  const previewJson = JSON.stringify(buildConfig(), null, 2);

  const handleSave = async () => {
    if (!repoRoot) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await writeStagehandConfig(repoRoot, previewJson);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setIsSaving(false);
    }
  };

  const overlay = useOverlayDismiss(onClose);

  /* Compute whether sections have values (for default open state) */
  const hasSetup =
    copyList.items.length > 0 ||
    symlinkList.items.length > 0 ||
    commandList.items.length > 0;
  const hasRuntime =
    !!runCommand.trim() ||
    !!browserUrl.trim() ||
    browserPresetList.items.length > 0 ||
    terminalList.items.length > 0 ||
    envList.items.length > 0 ||
    platforms.length > 0;
  const hasAgent = !!agentPrompt.trim() || !saveChatHistory;

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        aria-labelledby="setup-cfg-title"
        aria-modal="true"
        className={`${styles.dialog} ${styles.dialogConfig}`}
        role="dialog"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="setup-cfg-title">
            Project Configuration
          </h2>
          <button
            aria-label="Close"
            className={styles.closeBtn}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {isLoading ? (
          <div className={styles.form}>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              Loading config...
            </p>
          </div>
        ) : (
          <div className={styles.form}>
            {/* ---- Workspace Setup ---- */}
            <ConfigSection
              defaultOpen={hasSetup}
              description="Runs once when creating a new worktree workspace."
              summary={setupSummary(
                copyList.items,
                symlinkList.items,
                commandList.items,
              )}
              title="Workspace Setup"
            >
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
            </ConfigSection>

            {/* ---- Runtime ---- */}
            <ConfigSection
              defaultOpen={hasRuntime}
              description="Controls how workspaces run, what URL the browser opens to, and what terminals open."
              summary={runtimeSummary(
                runCommand,
                browserUrl,
                terminalList.items,
                envList.items,
                browserPresetList.items,
                platforms,
              )}
              title="Runtime"
            >
              <div className={styles.field}>
                <p className={styles.sectionTitle}>Target Platforms</p>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {(["ios", "android", "web"] as const).map((p) => (
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
                      {p === "ios"
                        ? "iOS"
                        : p === "android"
                          ? "Android"
                          : "Web"}
                    </label>
                  ))}
                </div>
                <p className={styles.helpText}>
                  Runtimes agents pre-allocate per workspace (iOS simulator,
                  Android emulator, headless Chromium). Leave empty if this
                  project doesn&apos;t need any of them — each unused runtime
                  still consumes CPU and memory.
                </p>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="setup-browser-url">
                  Default browser URL
                </label>
                <input
                  autoComplete="url"
                  className={styles.input}
                  id="setup-browser-url"
                  placeholder="http://localhost:3000"
                  type="text"
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                />
                <p className={styles.helpText}>
                  Default address for the web browser panel when a workspace has
                  not navigated elsewhere yet.
                </p>
              </div>

              <BrowserPresetField list={browserPresetList} />

              <div className={styles.field}>
                <p className={styles.sectionTitle}>Run Command</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className={styles.input}
                    placeholder="npx expo start"
                    style={{ flex: 2 }}
                    type="text"
                    value={runCommand}
                    onChange={(e) => setRunCommand(e.target.value)}
                  />
                  <input
                    className={styles.input}
                    placeholder="Directory (optional)"
                    style={{ flex: 1 }}
                    type="text"
                    value={runDir}
                    onChange={(e) => setRunDir(e.target.value)}
                  />
                </div>
                <p className={styles.helpText}>
                  Shell command for the &quot;Run&quot; button. Optionally
                  specify a relative directory.
                </p>
              </div>

              <TerminalField list={terminalList} />

              <EnvField list={envList} />
            </ConfigSection>

            {/* ---- Agent ---- */}
            <ConfigSection
              defaultOpen={hasAgent}
              description="Configuration for Claude agents working in this project."
              summary={agentSummary(agentPrompt, saveChatHistory)}
              title="Agent"
            >
              <div className={styles.field}>
                <p className={styles.sectionTitle}>System Prompt</p>
                <textarea
                  className={styles.input}
                  placeholder="Additional instructions appended to every agent's system prompt..."
                  rows={4}
                  style={{ resize: "vertical", fontFamily: "inherit" }}
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                />
                <p className={styles.helpText}>
                  Extra context or instructions appended to every agent&apos;s
                  system prompt.
                </p>
              </div>
              <div className={styles.field}>
                <label className={styles.checkboxRow}>
                  <input
                    checked={saveChatHistory}
                    type="checkbox"
                    onChange={(e) => setSaveChatHistory(e.target.checked)}
                  />
                  Save chat history
                </label>
                <p className={styles.helpText}>
                  Automatically save agent conversations when they end. Lets you
                  review and resume previous sessions.
                </p>
              </div>
            </ConfigSection>

            {/* ---- Preview toggle ---- */}
            <button
              className={styles.previewToggle}
              type="button"
              onClick={() => setShowPreview((p) => !p)}
            >
              <ChevronRightIcon
                className={`${styles.configSectionChevron} ${showPreview ? styles.configSectionChevronExpanded : ""}`}
              />
              {showPreview ? "Hide JSON" : "Show JSON"}
            </button>
            {showPreview && <pre className={styles.preview}>{previewJson}</pre>}

            {error && <p className={styles.errorMsg}>{error}</p>}
          </div>
        )}

        <div className={styles.stickyFooter}>
          <button className={styles.cancelBtn} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.submitBtn}
            disabled={isSaving || isLoading || !repoRoot}
            type="button"
            onClick={handleSave}
          >
            {isSaving ? "Saving..." : "Save .stagehand.json"}
          </button>
        </div>
      </div>
    </div>
  );
}
