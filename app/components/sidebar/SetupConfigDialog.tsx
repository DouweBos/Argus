import { useState, useEffect } from "react";
import { writeStagehandConfig, readStagehandConfig } from "../../lib/ipc";
import { useOverlayDismiss } from "../../hooks/useOverlayDismiss";
import type { StagehandConfig } from "../../lib/types";
import { CloseIcon } from "../shared/Icons";
import styles from "./Dialog.module.css";

interface SetupConfigDialogProps {
  onClose: () => void;
  onSaved?: () => void;
  repoRoot: string;
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

export function SetupConfigDialog({
  repoRoot,
  onClose,
  onSaved,
}: SetupConfigDialogProps) {
  const copyList = useListState([]);
  const symlinkList = useListState([]);
  const commandList = useListState([]);
  const terminalList = useTerminalListState([]);
  const [workspaceEnvName, setWorkspaceEnvName] = useState("");
  const [workspaceEnvBaseValue, setWorkspaceEnvBaseValue] = useState("");
  const [workspaceEnvRange, setWorkspaceEnvRange] = useState("");
  const [workspaceEnvStrategy, setWorkspaceEnvStrategy] = useState<
    "hash" | "sequential"
  >("hash");
  const [runCommand, setRunCommand] = useState("");
  const [runDir, setRunDir] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);

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
        const we = config.workspace_env;
        if (we) {
          setWorkspaceEnvName(we.name ?? "");
          if (we.base_value != null)
            setWorkspaceEnvBaseValue(String(we.base_value));
          if (we.range != null) setWorkspaceEnvRange(String(we.range));
          if (we.strategy) setWorkspaceEnvStrategy(we.strategy);
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
    const envName = workspaceEnvName.trim();
    if (envName) {
      const baseValue = parseInt(workspaceEnvBaseValue.trim(), 10);
      const range = parseInt(workspaceEnvRange.trim(), 10);
      config.workspace_env = {
        name: envName,
        base_value:
          !Number.isNaN(baseValue) && baseValue >= 0 ? baseValue : 8081,
        ...(!Number.isNaN(range) && range > 0 ? { range } : {}),
        ...(workspaceEnvStrategy !== "hash"
          ? { strategy: workspaceEnvStrategy }
          : {}),
      };
    }
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

  return (
    <div className={styles.overlay} {...overlay}>
      <div
        className={`${styles.dialog} ${styles.dialogWide}`}
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
            <ListSection
              label="Directories to Copy"
              placeholder="path/to/dir or *.env (glob)"
              list={copyList}
            />
            <ListSection
              label="Files to Symlink"
              placeholder="path/to/file or **/.env.local (glob)"
              list={symlinkList}
            />
            <ListSection
              label="Setup Commands"
              placeholder="npm install"
              list={commandList}
            />
            <div className={styles.field}>
              <p className={styles.sectionTitle}>Workspace Env</p>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  className={styles.input}
                  type="text"
                  value={workspaceEnvName}
                  onChange={(e) => setWorkspaceEnvName(e.target.value)}
                  placeholder="Env var name (e.g. STAGEHAND_PORT)"
                  style={{ maxWidth: 200 }}
                />
                <input
                  className={styles.input}
                  type="text"
                  value={workspaceEnvBaseValue}
                  onChange={(e) => setWorkspaceEnvBaseValue(e.target.value)}
                  placeholder="Base value (default 8081)"
                  style={{ maxWidth: 120 }}
                />
                <input
                  className={styles.input}
                  type="text"
                  value={workspaceEnvRange}
                  onChange={(e) => setWorkspaceEnvRange(e.target.value)}
                  placeholder="Range (default 1000)"
                  style={{ maxWidth: 120 }}
                />
                <select
                  className={styles.input}
                  value={workspaceEnvStrategy}
                  onChange={(e) =>
                    setWorkspaceEnvStrategy(
                      e.target.value as "hash" | "sequential",
                    )
                  }
                  style={{ maxWidth: 130 }}
                >
                  <option value="hash">Hash</option>
                  <option value="sequential">Sequential</option>
                </select>
              </div>
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--font-size-sm)",
                  marginTop: 4,
                }}
              >
                Sets an env var in each worktree workspace's terminals with a
                unique integer. Hash: base_value + hash % range. Sequential:
                base_value + index. Repo-root workspaces are skipped.
              </p>
            </div>
            <div className={styles.field}>
              <p className={styles.sectionTitle}>Run Command</p>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
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
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--font-size-sm)",
                  marginTop: 4,
                }}
              >
                Shell command for the "Run" button. Optionally specify a
                relative directory to run it in.
              </p>
            </div>
            <TerminalSection list={terminalList} />

            <div>
              <p className={styles.sectionTitle}>Preview</p>
              <pre className={styles.preview}>{previewJson}</pre>
            </div>

            {error && <p className={styles.errorMsg}>{error}</p>}

            <div className={styles.footer}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.submitBtn}
                onClick={handleSave}
                disabled={isSaving || !repoRoot}
              >
                {isSaving ? "Saving..." : "Save .stagehand.json"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ListSectionProps {
  label: string;
  list: ReturnType<typeof useListState>;
  placeholder: string;
}

function ListSection({ label, placeholder, list }: ListSectionProps) {
  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>{label}</p>
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
    </div>
  );
}

interface TerminalSectionProps {
  list: ReturnType<typeof useTerminalListState>;
}

function TerminalSection({ list }: TerminalSectionProps) {
  return (
    <div className={styles.field}>
      <p className={styles.sectionTitle}>Auto-open Terminals</p>
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
    </div>
  );
}
