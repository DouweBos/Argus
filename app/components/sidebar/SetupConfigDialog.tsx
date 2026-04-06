import { useState, useEffect } from "react";
import { writeStagehandConfig, readStagehandConfig } from "../../lib/ipc";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";
import type { StagehandConfig, WorkspaceEnvConfig } from "../../lib/types";
import { CloseIcon, ChevronRightIcon } from "../shared/Icons";
import styles from "./Dialog.module.css";

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
        onClick={() => setOpen((p) => !p)}
        type="button"
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
  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>{label}</p>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>{emptyLabel}</span>
          <button className={styles.addRowBtn} onClick={list.add}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((item, i) => (
            <div key={i} className={styles.listRow}>
              <input
                className={styles.input}
                type="text"
                value={item}
                onChange={(e) => list.update(i, e.target.value)}
                placeholder={placeholder}
              />
              <button
                className={styles.removeBtn}
                onClick={() => list.remove(i)}
                aria-label="Remove"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={list.add}>
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
  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>Auto-open Terminals</p>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No terminals configured</span>
          <button className={styles.addRowBtn} onClick={list.add}>
            + Add
          </button>
        </div>
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i} className={styles.listRow}>
              <input
                className={styles.input}
                type="text"
                value={entry.name}
                onChange={(e) => list.update(i, "name", e.target.value)}
                placeholder="Name (e.g. Frontend)"
                style={{ flex: 1 }}
              />
              <input
                className={styles.input}
                type="text"
                value={entry.dir}
                onChange={(e) => list.update(i, "dir", e.target.value)}
                placeholder="Dir (e.g. packages/web)"
                style={{ flex: 1 }}
              />
              <button
                className={styles.removeBtn}
                onClick={() => list.remove(i)}
                aria-label="Remove"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          <button className={styles.addRowBtn} onClick={list.add}>
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
  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>Workspace Environment Variables</p>
      {list.items.length === 0 ? (
        <div className={styles.emptyState}>
          <span>No env variables configured</span>
          <button className={styles.addRowBtn} onClick={list.add}>
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
                    type="text"
                    value={entry.name}
                    onChange={(e) => list.update(i, "name", e.target.value)}
                    placeholder="e.g. STAGEHAND_PORT"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Strategy</label>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <select
                      className={styles.input}
                      value={entry.strategy}
                      onChange={(e) =>
                        list.update(i, "strategy", e.target.value)
                      }
                      style={{ flex: 1 }}
                    >
                      <option value="hash">Hash</option>
                      <option value="sequential">Sequential</option>
                    </select>
                    <button
                      className={styles.removeBtn}
                      onClick={() => list.remove(i)}
                      aria-label="Remove env variable"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Base value</label>
                  <input
                    className={styles.input}
                    type="text"
                    value={entry.base_value}
                    onChange={(e) =>
                      list.update(i, "base_value", e.target.value)
                    }
                    placeholder="8081"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Range</label>
                  <input
                    className={styles.input}
                    type="text"
                    value={entry.range}
                    onChange={(e) => list.update(i, "range", e.target.value)}
                    placeholder="1000"
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
          <button className={styles.addRowBtn} onClick={list.add}>
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
  if (c) parts.push(`${c} copy`);
  if (s) parts.push(`${s} symlink`);
  if (cmd) parts.push(`${cmd} command${cmd > 1 ? "s" : ""}`);
  return parts.join(", ");
}

function runtimeSummary(
  runCommand: string,
  terminals: TerminalEntry[],
  envEntries: EnvEntry[],
): string {
  const parts: string[] = [];
  if (runCommand.trim()) parts.push(runCommand.trim());
  const t = terminals.filter((e) => e.name || e.dir).length;
  if (t) parts.push(`${t} terminal${t > 1 ? "s" : ""}`);
  const e = envEntries.filter((v) => v.name.trim()).length;
  if (e) parts.push(`${e} env var${e > 1 ? "s" : ""}`);
  return parts.join(", ");
}

function agentSummary(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "";
  return trimmed.length > 50 ? trimmed.slice(0, 50) + "..." : trimmed;
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
  const [runCommand, setRunCommand] = useState("");
  const [runDir, setRunDir] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await readStagehandConfig(repoRoot);
        if (cancelled) return;
        if (config.setup?.copy?.length) copyList.setItems(config.setup.copy);
        if (config.setup?.symlink?.length)
          symlinkList.setItems(config.setup.symlink);
        if (config.setup?.commands?.length)
          commandList.setItems(config.setup.commands);
        if (config.terminals?.length) {
          terminalList.setItems(
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
            if (config.run.dir) setRunDir(config.run.dir);
          }
        }
        if (config.agent_prompt) setAgentPrompt(config.agent_prompt);
        if (config.workspace_env?.length) {
          envList.setItems(
            config.workspace_env.map((we: WorkspaceEnvConfig) => ({
              name: we.name ?? "",
              base_value: we.base_value != null ? String(we.base_value) : "",
              range: we.range != null ? String(we.range) : "",
              strategy: we.strategy ?? "hash",
            })),
          );
        }
      } catch {
        // No config file or not readable — start with empty fields
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const buildConfig = (): StagehandConfig => {
    const config: StagehandConfig = { setup: {} };
    const copies = copyList.items.filter(Boolean);
    const symlinks = symlinkList.items.filter(Boolean);
    const commands = commandList.items.filter(Boolean);
    if (copies.length) config.setup!.copy = copies;
    if (symlinks.length) config.setup!.symlink = symlinks;
    if (commands.length) config.setup!.commands = commands;
    const terminals = terminalList.items.filter((t) => t.name || t.dir);
    if (terminals.length) config.terminals = terminals;
    const run = runCommand.trim();
    const runDirVal = runDir.trim();
    if (run) {
      config.run = runDirVal ? { command: run, dir: runDirVal } : run;
    }
    const agentPromptVal = agentPrompt.trim();
    if (agentPromptVal) config.agent_prompt = agentPromptVal;
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
    if (envVars.length) config.workspace_env = envVars;
    return config;
  };

  const previewJson = JSON.stringify(buildConfig(), null, 2);

  const handleSave = async () => {
    if (!repoRoot) return;
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
    terminalList.items.length > 0 ||
    envList.items.length > 0;
  const hasAgent = !!agentPrompt.trim();

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        className={`${styles.dialog} ${styles.dialogConfig}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-cfg-title"
      >
        <div className={styles.header}>
          <h2 id="setup-cfg-title" className={styles.title}>
            Project Configuration
          </h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
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
              title="Workspace Setup"
              description="Runs once when creating a new worktree workspace."
              summary={setupSummary(
                copyList.items,
                symlinkList.items,
                commandList.items,
              )}
              defaultOpen={hasSetup}
            >
              <ListField
                label="Copy"
                placeholder="path/to/dir or *.env (glob)"
                emptyLabel="No copy patterns"
                list={copyList}
              />
              <ListField
                label="Symlink"
                placeholder="path/to/file or **/.env.local (glob)"
                emptyLabel="No symlink patterns"
                list={symlinkList}
              />
              <ListField
                label="Commands"
                placeholder="npm install"
                emptyLabel="No setup commands"
                list={commandList}
              />
            </ConfigSection>

            {/* ---- Runtime ---- */}
            <ConfigSection
              title="Runtime"
              description="Controls how workspaces run and what terminals open."
              summary={runtimeSummary(
                runCommand,
                terminalList.items,
                envList.items,
              )}
              defaultOpen={hasRuntime}
            >
              <div className={styles.field}>
                <p className={styles.sectionTitle}>Run Command</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className={styles.input}
                    type="text"
                    value={runCommand}
                    onChange={(e) => setRunCommand(e.target.value)}
                    placeholder="npx expo start"
                    style={{ flex: 2 }}
                  />
                  <input
                    className={styles.input}
                    type="text"
                    value={runDir}
                    onChange={(e) => setRunDir(e.target.value)}
                    placeholder="Directory (optional)"
                    style={{ flex: 1 }}
                  />
                </div>
                <p className={styles.helpText}>
                  Shell command for the "Run" button. Optionally specify a
                  relative directory.
                </p>
              </div>

              <TerminalField list={terminalList} />

              <EnvField list={envList} />
            </ConfigSection>

            {/* ---- Agent ---- */}
            <ConfigSection
              title="Agent"
              description="Configuration for Claude agents working in this project."
              summary={agentSummary(agentPrompt)}
              defaultOpen={hasAgent}
            >
              <div className={styles.field}>
                <p className={styles.sectionTitle}>System Prompt</p>
                <textarea
                  className={styles.input}
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  placeholder="Additional instructions appended to every agent's system prompt..."
                  rows={4}
                  style={{ resize: "vertical", fontFamily: "inherit" }}
                />
                <p className={styles.helpText}>
                  Extra context or instructions appended to every agent's system
                  prompt.
                </p>
              </div>
            </ConfigSection>

            {/* ---- Preview toggle ---- */}
            <button
              className={styles.previewToggle}
              onClick={() => setShowPreview((p) => !p)}
              type="button"
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
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={handleSave}
            disabled={isSaving || isLoading || !repoRoot}
          >
            {isSaving ? "Saving..." : "Save .stagehand.json"}
          </button>
        </div>
      </div>
    </div>
  );
}
