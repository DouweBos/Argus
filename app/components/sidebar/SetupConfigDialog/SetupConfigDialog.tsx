import type {
  BrowserPresetConfig,
  ProjectAutomationConfig,
  RelatedProject,
  RuntimePlatform,
  SetupCopyEntry,
  SimulatorDeeplinkConfig,
  ArgusConfig,
  WorkspaceEnvConfig,
} from "../../../lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Chip,
  CodeBlock,
  DialogFooter,
  EmptyState,
  Icons,
  Input,
  PlatformChip,
  SettingsDialogShell,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  TextArea,
  TreeNode,
  type SettingsDialogGroup,
} from "@argus/peacock";
import {
  getUserProjectSettings,
  readArgusConfig,
  setUserProjectSettings,
  writeArgusConfig,
} from "../../../lib/ipc";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { dialogStyles as styles } from "../../shared/Dialog";
import {
  InheritedMcpList,
  McpServersField,
  entriesToMap,
  entriesValid,
  mapToEntries,
  type McpEntry,
} from "../../shared/McpServersField";
import { GlobPathInput } from "./GlobPathInput";
import { ProjectAutomationsField } from "./ProjectAutomationsField";
import { ProjectToolsField } from "./ProjectToolsField";
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

interface RunnerOptionsProps {
  onChange: (runnerId: string) => void;
  /** Empty string means "inherit app-level default". */
  selected: string;
}

/**
 * Registry-driven runner picker for the project-level LLM section. Mirrors
 * the app-level Settings dialog. Always includes an "Inherit" option (empty
 * string) so the project can fall back to the app default; if `selected` is
 * a value not in the registry — e.g. set by a teammate whose app has a
 * runner this app doesn't — we surface it as an extra "(unknown)" option so
 * saving doesn't silently change it.
 */
function RunnerOptions({ onChange, selected }: RunnerOptionsProps) {
  const registered = useRegisteredRunners();
  const baseOptions =
    registered.length > 0
      ? registered.map((r) => ({
          id: r.id,
          label: r.displayName,
          unknown: false,
        }))
      : [{ id: "claude-code", label: "Claude Code", unknown: false }];
  const options: { id: string; label: string; unknown: boolean }[] = [
    { id: "", label: "Inherit app default", unknown: false },
    ...baseOptions,
  ];
  if (selected && !options.some((o) => o.id === selected)) {
    options.push({
      id: selected,
      label: `${selected} (unknown)`,
      unknown: true,
    });
  }

  return (
    <div className={sectionStyles.runnerOptions}>
      {options.map((opt) => {
        const active = selected === opt.id;
        const className = [
          sectionStyles.runnerOption,
          active ? sectionStyles.runnerOptionActive : "",
          opt.unknown ? sectionStyles.runnerOptionUnknown : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <label key={opt.id || "__inherit__"} className={className}>
            <input
              checked={active}
              className={sectionStyles.runnerRadio}
              name="setup-llm-runner"
              type="radio"
              value={opt.id}
              onChange={() => onChange(opt.id)}
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

/**
 * Split a `setup.copy` / `setup.symlink` array into the path strings
 * displayed in the dialog and a side map of `path -> exclude[]` so we can
 * round-trip the structured form on save (the dialog UI itself only edits
 * paths today).
 */
function splitSetupEntries(entries: SetupCopyEntry[]): {
  excludes: Map<string, string[]>;
  paths: string[];
} {
  const paths: string[] = [];
  const excludes = new Map<string, string[]>();
  for (const entry of entries) {
    if (typeof entry === "string") {
      paths.push(entry);
    } else {
      paths.push(entry.path);
      if (entry.exclude && entry.exclude.length > 0) {
        excludes.set(entry.path, entry.exclude);
      }
    }
  }

  return { paths, excludes };
}

/**
 * Re-attach the round-tripped excludes from `splitSetupEntries` onto the
 * current dialog path list. Paths the user added in the dialog stay as bare
 * strings; paths that originally had excludes get re-emitted as
 * `{ path, exclude }` so hand-authored config isn't silently flattened.
 */
function mergeSetupEntries(
  paths: string[],
  excludes: Map<string, string[]>,
): SetupCopyEntry[] {
  return paths.map((path) => {
    const exclude = excludes.get(path);

    return exclude && exclude.length > 0 ? { path, exclude } : path;
  });
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
  const move = (i: number, direction: -1 | 1) =>
    setItems((prev) => {
      const target = i + direction;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      [next[i], next[target]] = [next[target], next[i]];

      return next;
    });

  return { items, setItems, add, update, remove, move };
}

interface BrowserPresetEntry {
  height: string;
  id: string;
  label: string;
  user_agent: string;
  width: string;
}

interface DeeplinkEntry {
  /** Folder children. `undefined` means this entry is a leaf. */
  children?: DeeplinkEntry[];
  label: string;
  /** Leaf URL. `undefined` means this entry is a folder. */
  url?: string;
}

/** Path of indices into a nested DeeplinkEntry[] tree. */
type DeeplinkPath = number[];

function deeplinkConfigToEntries(
  configs: SimulatorDeeplinkConfig[],
): DeeplinkEntry[] {
  return configs.map((c) => {
    if (Array.isArray(c.children)) {
      return {
        label: c.label ?? "",
        children: deeplinkConfigToEntries(c.children),
      };
    }

    return { label: c.label ?? "", url: c.url ?? "" };
  });
}

function deeplinkEntriesToConfig(
  entries: DeeplinkEntry[],
): SimulatorDeeplinkConfig[] {
  const out: SimulatorDeeplinkConfig[] = [];
  for (const e of entries) {
    const label = e.label.trim();
    if (!label) {
      continue;
    }
    if (e.children !== undefined) {
      const kids = deeplinkEntriesToConfig(e.children);
      if (kids.length > 0) {
        out.push({ label, children: kids });
      }
    } else if (e.url && e.url.trim()) {
      out.push({ label, url: e.url.trim() });
    }
  }

  return out;
}

function updateAtPath(
  entries: DeeplinkEntry[],
  path: DeeplinkPath,
  mutator: (siblings: DeeplinkEntry[]) => DeeplinkEntry[],
): DeeplinkEntry[] {
  if (path.length === 0) {
    return mutator(entries);
  }
  const [head, ...rest] = path;

  return entries.map((entry, idx) => {
    if (idx !== head) {
      return entry;
    }
    if (entry.children === undefined) {
      return entry;
    }

    return { ...entry, children: updateAtPath(entry.children, rest, mutator) };
  });
}

function readAtPath(
  entries: DeeplinkEntry[],
  path: DeeplinkPath,
): DeeplinkEntry | null {
  if (path.length === 0) {
    return null;
  }
  let arr: DeeplinkEntry[] | undefined = entries;
  for (let i = 0; i < path.length - 1; i++) {
    const child: DeeplinkEntry | undefined = arr?.[path[i]];
    if (!child || !child.children) {
      return null;
    }
    arr = child.children;
  }

  return arr?.[path[path.length - 1]] ?? null;
}

function pathsEqual(a: DeeplinkPath, b: DeeplinkPath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True if `prefix` equals `path` or is a strict ancestor of it. */
function isAncestorOrSelf(prefix: DeeplinkPath, path: DeeplinkPath): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Adjust a target path under the assumption that the entry at `removed` has
 * been spliced out of the tree. Only paths that point into the same sibling
 * array as `removed`, at an index after it, need their corresponding segment
 * decremented.
 */
function adjustPathForRemoval(
  target: DeeplinkPath,
  removed: DeeplinkPath,
): DeeplinkPath {
  if (removed.length === 0) {
    return target;
  }
  const removedParent = removed.slice(0, -1);
  const removedIdx = removed[removed.length - 1];
  if (target.length <= removedParent.length) {
    return target;
  }
  for (let i = 0; i < removedParent.length; i++) {
    if (target[i] !== removedParent[i]) {
      return target;
    }
  }
  if (target[removedParent.length] > removedIdx) {
    const adj = target.slice();
    adj[removedParent.length] -= 1;

    return adj;
  }

  return target;
}

function useDeeplinkListState(initial: DeeplinkEntry[]) {
  const [items, setItems] = useState<DeeplinkEntry[]>(initial);

  const addLink = (parentPath: DeeplinkPath) =>
    setItems((prev) =>
      updateAtPath(prev, parentPath, (siblings) => [
        ...siblings,
        { label: "", url: "" },
      ]),
    );
  const addFolder = (parentPath: DeeplinkPath) =>
    setItems((prev) =>
      updateAtPath(prev, parentPath, (siblings) => [
        ...siblings,
        { label: "", children: [] },
      ]),
    );
  const updateField = (
    path: DeeplinkPath,
    field: "label" | "url",
    val: string,
  ) => {
    if (path.length === 0) {
      return;
    }
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    setItems((prev) =>
      updateAtPath(prev, parent, (siblings) =>
        siblings.map((e, i) => (i === idx ? { ...e, [field]: val } : e)),
      ),
    );
  };
  const remove = (path: DeeplinkPath) => {
    if (path.length === 0) {
      return;
    }
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    setItems((prev) =>
      updateAtPath(prev, parent, (siblings) =>
        siblings.filter((_, i) => i !== idx),
      ),
    );
  };
  const move = (
    fromPath: DeeplinkPath,
    toParent: DeeplinkPath,
    toIndex: number,
  ) => {
    if (fromPath.length === 0) {
      return;
    }
    // Forbid dropping a folder onto itself or one of its descendants.
    if (isAncestorOrSelf(fromPath, toParent)) {
      return;
    }
    setItems((prev) => {
      const entry = readAtPath(prev, fromPath);
      if (!entry) {
        return prev;
      }
      const fromParent = fromPath.slice(0, -1);
      const fromIdx = fromPath[fromPath.length - 1];

      // Adjust target parent for the removal.
      const adjParent = adjustPathForRemoval(toParent, fromPath);

      // Adjust insertion index when reordering within the same array.
      let adjIndex = toIndex;
      if (pathsEqual(fromParent, adjParent) && toIndex > fromIdx) {
        adjIndex -= 1;
      }

      // Remove source.
      const removed = updateAtPath(prev, fromParent, (siblings) =>
        siblings.filter((_, i) => i !== fromIdx),
      );

      // Insert at adjusted target.
      return updateAtPath(removed, adjParent, (siblings) => {
        const next = siblings.slice();
        const clamped = Math.max(0, Math.min(adjIndex, next.length));
        next.splice(clamped, 0, entry);

        return next;
      });
    });
  };

  return { items, setItems, addLink, addFolder, updateField, remove, move };
}

interface RelatedProjectEntry {
  description: string;
  path: string;
}

function useRelatedProjectListState(initial: RelatedProjectEntry[]) {
  const [items, setItems] = useState<RelatedProjectEntry[]>(initial);
  const add = () =>
    setItems((prev) => [...prev, { path: "", description: "" }]);
  const update = (i: number, field: keyof RelatedProjectEntry, val: string) =>
    setItems((prev) =>
      prev.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry,
      ),
    );
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  return { items, setItems, add, update, remove };
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
        <EmptyState
          action={
            <Button
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleListAdd}
            >
              Add
            </Button>
          }
          className={sectionStyles.inlineEmptyState}
          title={emptyLabel}
        />
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((item, i) => (
            <div key={i} className={sectionStyles.rowCard}>
              <Input
                placeholder={placeholder}
                style={{ flex: 1 }}
                type="text"
                value={item}
                onChange={(e) => list.update(i, e.target.value)}
              />
              <button
                aria-label="Remove"
                className={[styles.removeBtn, sectionStyles.rowCardAction].join(
                  " ",
                )}
                onClick={() => list.remove(i)}
              >
                <Icons.CloseIcon size={12} />
              </button>
            </div>
          ))}
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            variant="ghost"
            onClick={handleListAdd}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function TerminalField({
  list,
  repoRoot,
}: {
  list: ReturnType<typeof useTerminalListState>;
  repoRoot: string;
}) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <EmptyState
          action={
            <Button
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleAdd}
            >
              Add terminal
            </Button>
          }
          className={sectionStyles.inlineEmptyState}
          icon={<Icons.TerminalIcon size={18} />}
          title="No terminals configured"
        />
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i} className={sectionStyles.rowCard}>
              <Input
                placeholder="Name (e.g. Frontend)"
                style={{ flex: 1 }}
                type="text"
                value={entry.name}
                onChange={(e) => list.update(i, "name", e.target.value)}
              />
              <GlobPathInput
                placeholder="Dir (e.g. packages/web)"
                repoRoot={repoRoot}
                style={{ flex: 1, minWidth: 0 }}
                value={entry.dir}
                onChange={(value) => list.update(i, "dir", value)}
              />
              <button
                aria-label="Remove"
                className={[styles.removeBtn, sectionStyles.rowCardAction].join(
                  " ",
                )}
                onClick={() => list.remove(i)}
              >
                <Icons.CloseIcon size={12} />
              </button>
            </div>
          ))}
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            variant="ghost"
            onClick={handleAdd}
          >
            Add
          </Button>
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
        <EmptyState
          action={
            <Button
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleAdd}
            >
              Add command
            </Button>
          }
          className={sectionStyles.inlineEmptyState}
          icon={<Icons.PlayIcon size={18} />}
          title="No run commands configured"
        />
      ) : (
        <div className={sectionStyles.runCommandList}>
          {list.items.map((entry, i) => {
            const otherTitles = list.items
              .map((e, idx) => ({ title: e.title.trim(), idx }))
              .filter((e) => e.idx !== i && e.title.length > 0);
            const toggleRequires = (req: string) => {
              const active = entry.requires.includes(req);
              const next = active
                ? entry.requires.filter((r) => r !== req)
                : [...entry.requires, req];
              list.update(i, "requires", next);
            };

            const hasFooter = entry.restartOnRerun || otherTitles.length > 0;

            return (
              <div key={i} className={sectionStyles.runCommandCard}>
                <div className={sectionStyles.runCommandTopRow}>
                  <Input
                    placeholder="Title (e.g. Dev)"
                    style={{ flex: 1, minWidth: 90 }}
                    type="text"
                    value={entry.title}
                    onChange={(e) => list.update(i, "title", e.target.value)}
                  />
                  <Input
                    placeholder="Command (e.g. pnpm dev)"
                    style={{ flex: 2, minWidth: 140 }}
                    type="text"
                    value={entry.command}
                    onChange={(e) => list.update(i, "command", e.target.value)}
                  />
                  <Input
                    placeholder="cwd (optional)"
                    style={{ flex: 1, minWidth: 80 }}
                    type="text"
                    value={entry.cwd}
                    onChange={(e) => list.update(i, "cwd", e.target.value)}
                  />
                  <div className={sectionStyles.runCommandReorder}>
                    <button
                      aria-label="Move up"
                      className={sectionStyles.reorderBtn}
                      disabled={i === 0}
                      onClick={() => list.move(i, -1)}
                    >
                      <Icons.ChevronUpIcon size={12} />
                    </button>
                    <button
                      aria-label="Move down"
                      className={sectionStyles.reorderBtn}
                      disabled={i === list.items.length - 1}
                      onClick={() => list.move(i, 1)}
                    >
                      <Icons.ChevronDownIcon size={12} />
                    </button>
                  </div>
                  <button
                    aria-label="Remove"
                    className={[
                      styles.removeBtn,
                      sectionStyles.rowCardAction,
                    ].join(" ")}
                    onClick={() => list.remove(i)}
                  >
                    <Icons.CloseIcon size={12} />
                  </button>
                </div>
                {hasFooter && (
                  <div className={sectionStyles.runCommandRestartRow}>
                    <label className={sectionStyles.cardCheckbox}>
                      <input
                        checked={entry.restartOnRerun}
                        type="checkbox"
                        onChange={(e) =>
                          list.update(i, "restartOnRerun", e.target.checked)
                        }
                      />
                      Restart on rerun
                    </label>
                  </div>
                )}
                {otherTitles.length > 0 && (
                  <div className={sectionStyles.runCommandRequiresRow}>
                    <span className={sectionStyles.runCommandRequiresLabel}>
                      Requires
                    </span>
                    <div className={sectionStyles.runCommandRequiresChips}>
                      {otherTitles.map((o) => (
                        <Chip
                          key={o.idx}
                          interactive
                          selected={entry.requires.includes(o.title)}
                          onClick={() => toggleRequires(o.title)}
                        >
                          {o.title}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            variant="ghost"
            onClick={handleAdd}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function EnvField({ list }: { list: ReturnType<typeof useEnvListState> }) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <EmptyState
          action={
            <Button
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleAdd}
            >
              Add variable
            </Button>
          }
          className={sectionStyles.inlineEmptyState}
          icon={<Icons.GearIcon size={18} />}
          title="No env variables configured"
        />
      ) : (
        <div className={sectionStyles.cardList}>
          {list.items.map((entry, i) => (
            <div key={i} className={sectionStyles.card}>
              <div className={sectionStyles.cardTopRow}>
                <div className={styles.field} style={{ flex: 2 }}>
                  <label className={sectionStyles.fieldLabel}>
                    Env var name
                  </label>
                  <Input
                    placeholder="e.g. ARGUS_PORT"
                    type="text"
                    value={entry.name}
                    onChange={(e) => list.update(i, "name", e.target.value)}
                  />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={sectionStyles.fieldLabel}>Base value</label>
                  <Input
                    placeholder="8081"
                    type="text"
                    value={entry.base_value}
                    onChange={(e) =>
                      list.update(i, "base_value", e.target.value)
                    }
                  />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={sectionStyles.fieldLabel}>Range</label>
                  <Input
                    placeholder="1000"
                    type="text"
                    value={entry.range}
                    onChange={(e) => list.update(i, "range", e.target.value)}
                  />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={sectionStyles.fieldLabel}>Strategy</label>
                  <select
                    className={styles.input}
                    value={entry.strategy}
                    onChange={(e) => list.update(i, "strategy", e.target.value)}
                  >
                    <option value="hash">Hash</option>
                    <option value="sequential">Sequential</option>
                  </select>
                </div>
                <button
                  aria-label="Remove env variable"
                  className={[
                    styles.removeBtn,
                    sectionStyles.rowCardAction,
                  ].join(" ")}
                  style={{ alignSelf: "flex-end", marginBottom: 1 }}
                  onClick={() => list.remove(i)}
                >
                  <Icons.CloseIcon size={12} />
                </button>
              </div>
            </div>
          ))}
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            variant="ghost"
            onClick={handleAdd}
          >
            Add
          </Button>
        </div>
      )}
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
      <p className={styles.sectionTitle}>Device presets</p>
      {list.items.length === 0 ? (
        <EmptyState
          action={
            <Button
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleAdd}
            >
              Add preset
            </Button>
          }
          className={sectionStyles.inlineEmptyState}
          title="No custom presets"
        />
      ) : (
        <div className={sectionStyles.cardList}>
          {list.items.map((entry, i) => (
            <div key={i} className={sectionStyles.card}>
              <div className={sectionStyles.cardTopRow}>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={sectionStyles.fieldLabel}>ID</label>
                  <Input
                    placeholder="e.g. iphone-15-pro"
                    type="text"
                    value={entry.id}
                    onChange={(e) => list.update(i, "id", e.target.value)}
                  />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={sectionStyles.fieldLabel}>Label</label>
                  <Input
                    placeholder="e.g. iPhone 15 Pro"
                    type="text"
                    value={entry.label}
                    onChange={(e) => list.update(i, "label", e.target.value)}
                  />
                </div>
                <div className={styles.field} style={{ flex: "0 0 70px" }}>
                  <label className={sectionStyles.fieldLabel}>Width</label>
                  <Input
                    placeholder="393"
                    type="text"
                    value={entry.width}
                    onChange={(e) => list.update(i, "width", e.target.value)}
                  />
                </div>
                <div className={styles.field} style={{ flex: "0 0 70px" }}>
                  <label className={sectionStyles.fieldLabel}>Height</label>
                  <Input
                    placeholder="852"
                    type="text"
                    value={entry.height}
                    onChange={(e) => list.update(i, "height", e.target.value)}
                  />
                </div>
                <button
                  aria-label="Remove preset"
                  className={[
                    styles.removeBtn,
                    sectionStyles.rowCardAction,
                  ].join(" ")}
                  style={{ alignSelf: "flex-end", marginBottom: 1 }}
                  onClick={() => list.remove(i)}
                >
                  <Icons.CloseIcon size={12} />
                </button>
              </div>
              <div className={styles.field}>
                <label className={sectionStyles.fieldLabel}>
                  User agent (optional)
                </label>
                <Input
                  placeholder="Defaults to desktop Chrome UA"
                  type="text"
                  value={entry.user_agent}
                  onChange={(e) => list.update(i, "user_agent", e.target.value)}
                />
              </div>
            </div>
          ))}
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            variant="ghost"
            onClick={handleAdd}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Deep link tree editor                                              */
/* ------------------------------------------------------------------ */

type DropPosition = "after" | "before" | "into";

interface DropTargetState {
  path: DeeplinkPath;
  position: DropPosition;
}

const DEEPLINK_DRAG_MIME = "application/x-deeplink-path";

function useDeeplinkDnD(list: ReturnType<typeof useDeeplinkListState>) {
  const draggedPathRef = useRef<DeeplinkPath | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);

  const handleGripDragStart = (
    e: React.DragEvent<HTMLElement>,
    path: DeeplinkPath,
    rowEl: HTMLElement | null,
  ) => {
    draggedPathRef.current = path;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DEEPLINK_DRAG_MIME, JSON.stringify(path));
    if (rowEl) {
      const rect = rowEl.getBoundingClientRect();
      e.dataTransfer.setDragImage(
        rowEl,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    }
  };

  const handleDragEnd = () => {
    draggedPathRef.current = null;
    setDropTarget(null);
  };

  const computeLeafPosition = (
    e: React.DragEvent<HTMLElement>,
  ): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect();

    return e.clientY - rect.top < rect.height / 2 ? "before" : "after";
  };

  const computeFolderPosition = (
    e: React.DragEvent<HTMLElement>,
  ): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height * 0.25) {
      return "before";
    }
    if (y > rect.height * 0.75) {
      return "after";
    }

    return "into";
  };

  const handleRowDragOver = (
    e: React.DragEvent<HTMLElement>,
    path: DeeplinkPath,
    isFolder: boolean,
  ) => {
    const dragged = draggedPathRef.current;
    if (!dragged) {
      return;
    }
    // Disallow dropping a folder into itself or its descendants.
    if (isAncestorOrSelf(dragged, path)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = isFolder
      ? computeFolderPosition(e)
      : computeLeafPosition(e);
    setDropTarget((prev) =>
      prev && prev.position === position && pathsEqual(prev.path, path)
        ? prev
        : { path, position },
    );
  };

  const handleRowDragLeave = (e: React.DragEvent<HTMLElement>) => {
    // Only clear the indicator if leaving the row entirely (not entering a
    // child element). relatedTarget is the element being entered.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) {
      return;
    }
    setDropTarget((prev) => prev);
  };

  const handleRowDrop = (
    e: React.DragEvent<HTMLElement>,
    path: DeeplinkPath,
    isFolder: boolean,
  ) => {
    const dragged = draggedPathRef.current;
    setDropTarget(null);
    draggedPathRef.current = null;
    if (!dragged) {
      return;
    }
    if (isAncestorOrSelf(dragged, path)) {
      return;
    }
    e.preventDefault();
    const position = isFolder
      ? computeFolderPosition(e)
      : computeLeafPosition(e);
    const targetParent = path.slice(0, -1);
    const targetIdx = path[path.length - 1];

    if (position === "before") {
      list.move(dragged, targetParent, targetIdx);
    } else if (position === "after") {
      list.move(dragged, targetParent, targetIdx + 1);
    } else {
      // into folder — append at end of children
      const children = readAtPath(list.items, path)?.children ?? [];
      list.move(dragged, path, children.length);
    }
  };

  const handleEmptyFolderDrop = (
    e: React.DragEvent<HTMLElement>,
    folderPath: DeeplinkPath,
  ) => {
    const dragged = draggedPathRef.current;
    setDropTarget(null);
    draggedPathRef.current = null;
    if (!dragged) {
      return;
    }
    if (isAncestorOrSelf(dragged, folderPath)) {
      return;
    }
    e.preventDefault();
    list.move(dragged, folderPath, 0);
  };

  const handleEmptyFolderDragOver = (
    e: React.DragEvent<HTMLElement>,
    folderPath: DeeplinkPath,
  ) => {
    const dragged = draggedPathRef.current;
    if (!dragged) {
      return;
    }
    if (isAncestorOrSelf(dragged, folderPath)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ path: folderPath, position: "into" });
  };

  return {
    dropTarget,
    handleGripDragStart,
    handleDragEnd,
    handleRowDragOver,
    handleRowDragLeave,
    handleRowDrop,
    handleEmptyFolderDragOver,
    handleEmptyFolderDrop,
  };
}

type DeeplinkDnD = ReturnType<typeof useDeeplinkDnD>;

interface DeeplinkLeafRowProps {
  dnd: DeeplinkDnD;
  entry: DeeplinkEntry;
  list: ReturnType<typeof useDeeplinkListState>;
  path: DeeplinkPath;
}

function dropTargetClass(
  dropTarget: DropTargetState | null,
  path: DeeplinkPath,
  allowInto: boolean,
): string {
  if (!dropTarget || !pathsEqual(dropTarget.path, path)) {
    return "";
  }
  if (dropTarget.position === "before") {
    return sectionStyles.dropBefore;
  }
  if (dropTarget.position === "after") {
    return sectionStyles.dropAfter;
  }
  if (allowInto && dropTarget.position === "into") {
    return sectionStyles.dropInto;
  }

  return "";
}

function DeeplinkLeafRow({ entry, path, list, dnd }: DeeplinkLeafRowProps) {
  const labelEmpty = entry.label.trim() === "";
  const urlEmpty = (entry.url ?? "").trim() === "";
  const rowRef = useRef<HTMLDivElement>(null);
  const dropClass = dropTargetClass(dnd.dropTarget, path, false);

  return (
    <div
      ref={rowRef}
      className={[sectionStyles.deeplinkLeaf, dropClass]
        .filter(Boolean)
        .join(" ")}
      onDragLeave={dnd.handleRowDragLeave}
      onDragOver={(e) => dnd.handleRowDragOver(e, path, false)}
      onDrop={(e) => dnd.handleRowDrop(e, path, false)}
    >
      <span
        aria-label="Drag to reorder"
        className={sectionStyles.deeplinkGripHandle}
        draggable
        role="button"
        onDragEnd={dnd.handleDragEnd}
        onDragStart={(e) => dnd.handleGripDragStart(e, path, rowRef.current)}
      >
        <Icons.GripDotsIcon
          aria-hidden
          className={sectionStyles.deeplinkGrip}
          size={12}
        />
      </span>
      <Input
        className={labelEmpty ? sectionStyles.deeplinkInputWarn : undefined}
        placeholder="Label"
        type="text"
        value={entry.label}
        onChange={(e) => list.updateField(path, "label", e.target.value)}
      />
      <Input
        mono
        className={urlEmpty ? sectionStyles.deeplinkInputWarn : undefined}
        placeholder="myapp://screen/id"
        type="text"
        value={entry.url ?? ""}
        onChange={(e) => list.updateField(path, "url", e.target.value)}
      />
      <button
        aria-label="Remove deep link"
        className={[styles.removeBtn, sectionStyles.deeplinkRowDelete]
          .filter(Boolean)
          .join(" ")}
        onClick={() => list.remove(path)}
      >
        <Icons.CloseIcon size={12} />
      </button>
    </div>
  );
}

interface DeeplinkFolderRowProps {
  dnd: DeeplinkDnD;
  entry: DeeplinkEntry;
  expanded: boolean;
  list: ReturnType<typeof useDeeplinkListState>;
  onToggle: () => void;
  path: DeeplinkPath;
}

function DeeplinkFolderRow({
  entry,
  path,
  list,
  expanded,
  onToggle,
  dnd,
}: DeeplinkFolderRowProps) {
  const children = entry.children ?? [];
  const count = children.length;
  const labelEmpty = entry.label.trim() === "";

  const peek = !expanded
    ? children
        .slice(0, 2)
        .map((c) => c.label.trim() || (c.url ?? ""))
        .filter(Boolean)
        .join(", ")
    : null;

  const rowRef = useRef<HTMLDivElement>(null);
  const dropClass = dropTargetClass(dnd.dropTarget, path, true);

  return (
    <div
      ref={rowRef}
      className={[sectionStyles.deeplinkFolderHeader, dropClass]
        .filter(Boolean)
        .join(" ")}
      onDragLeave={dnd.handleRowDragLeave}
      onDragOver={(e) => dnd.handleRowDragOver(e, path, true)}
      onDrop={(e) => dnd.handleRowDrop(e, path, true)}
    >
      <span
        aria-label="Drag to reorder"
        className={sectionStyles.deeplinkGripHandle}
        draggable
        role="button"
        onDragEnd={dnd.handleDragEnd}
        onDragStart={(e) => dnd.handleGripDragStart(e, path, rowRef.current)}
      >
        <Icons.GripDotsIcon
          aria-hidden
          className={sectionStyles.deeplinkGrip}
          size={12}
        />
      </span>
      <button
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse folder" : "Expand folder"}
        className={sectionStyles.deeplinkChevronBtn}
        onClick={onToggle}
      >
        {expanded ? (
          <Icons.ChevronDownIcon size={10} />
        ) : (
          <Icons.ChevronRightIcon size={10} />
        )}
      </button>
      <Icons.FolderIcon
        className={sectionStyles.deeplinkFolderIcon}
        size={14}
      />
      <Input
        className={[
          sectionStyles.deeplinkFolderInput,
          labelEmpty ? sectionStyles.deeplinkInputWarn : "",
        ]
          .filter(Boolean)
          .join(" ")}
        placeholder="Folder name"
        type="text"
        value={entry.label}
        onChange={(e) => list.updateField(path, "label", e.target.value)}
      />
      <div className={sectionStyles.deeplinkFolderSpacer} />
      <div className={sectionStyles.deeplinkFolderTrailing}>
        {!expanded && peek && (
          <span className={sectionStyles.deeplinkPeek} title={peek}>
            {peek}
          </span>
        )}
        {count > 0 && (
          <Badge size="pill" tone="neutralFilled">
            {count}
          </Badge>
        )}
        <button
          aria-label="Remove folder"
          className={[styles.removeBtn, sectionStyles.deeplinkRowDelete]
            .filter(Boolean)
            .join(" ")}
          onClick={() => list.remove(path)}
        >
          <Icons.CloseIcon size={12} />
        </button>
      </div>
    </div>
  );
}

interface DeeplinkAddRowProps {
  list: ReturnType<typeof useDeeplinkListState>;
  parentPath: DeeplinkPath;
  /** When true, uses the root-level prominent add-row style. */
  root?: boolean;
}

function DeeplinkAddRow({ parentPath, list, root }: DeeplinkAddRowProps) {
  return (
    <div
      className={
        root ? sectionStyles.deeplinkAddRowRoot : sectionStyles.deeplinkAddRow
      }
    >
      <Button
        leading={<Icons.PlusIcon size={11} />}
        size="sm"
        variant="ghost"
        onClick={() => list.addLink(parentPath)}
      >
        Link
      </Button>
      <Button
        leading={<Icons.FolderIcon size={12} />}
        size="sm"
        variant="ghost"
        onClick={() => list.addFolder(parentPath)}
      >
        Folder
      </Button>
    </div>
  );
}

interface DeeplinkTreeProps {
  dnd: DeeplinkDnD;
  entries: DeeplinkEntry[];
  list: ReturnType<typeof useDeeplinkListState>;
  parentPath: DeeplinkPath;
}

function DeeplinkFolderEmptyPlaceholder({
  parentPath,
  list,
  dnd,
}: {
  dnd: DeeplinkDnD;
  list: ReturnType<typeof useDeeplinkListState>;
  parentPath: DeeplinkPath;
}) {
  const isDropTarget =
    dnd.dropTarget &&
    dnd.dropTarget.position === "into" &&
    pathsEqual(dnd.dropTarget.path, parentPath);

  return (
    <div
      className={[
        sectionStyles.deeplinkFolderEmpty,
        isDropTarget ? sectionStyles.dropInto : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragLeave={dnd.handleRowDragLeave}
      onDragOver={(e) => dnd.handleEmptyFolderDragOver(e, parentPath)}
      onDrop={(e) => dnd.handleEmptyFolderDrop(e, parentPath)}
    >
      <span className={sectionStyles.deeplinkFolderEmptyLabel}>
        No links yet
      </span>
      <div className={sectionStyles.deeplinkFolderEmptyActions}>
        <Button
          leading={<Icons.PlusIcon size={11} />}
          size="sm"
          variant="ghost"
          onClick={() => list.addLink(parentPath)}
        >
          Link
        </Button>
        <Button
          leading={<Icons.FolderIcon size={12} />}
          size="sm"
          variant="ghost"
          onClick={() => list.addFolder(parentPath)}
        >
          Folder
        </Button>
      </div>
    </div>
  );
}

function DeeplinkTree({ entries, list, parentPath, dnd }: DeeplinkTreeProps) {
  const [expandedSet, setExpandedSet] = useState<Set<number>>(
    () => new Set(entries.map((_, i) => i)),
  );

  const toggleExpanded = (i: number) =>
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }

      return next;
    });

  return (
    <>
      {entries.map((entry, i) => {
        const path = [...parentPath, i];
        const isFolder = entry.children !== undefined;

        if (isFolder) {
          const expanded = expandedSet.has(i);
          const folderChildren = entry.children ?? [];
          const isEmpty = folderChildren.length === 0;

          return (
            <TreeNode
              key={i}
              collapsed={!expanded}
              header={
                <DeeplinkFolderRow
                  dnd={dnd}
                  entry={entry}
                  expanded={expanded}
                  list={list}
                  path={path}
                  onToggle={() => toggleExpanded(i)}
                />
              }
            >
              {isEmpty ? (
                <DeeplinkFolderEmptyPlaceholder
                  dnd={dnd}
                  list={list}
                  parentPath={path}
                />
              ) : (
                <>
                  <DeeplinkTree
                    dnd={dnd}
                    entries={folderChildren}
                    list={list}
                    parentPath={path}
                  />
                  <DeeplinkAddRow list={list} parentPath={path} />
                </>
              )}
            </TreeNode>
          );
        }

        return (
          <DeeplinkLeafRow
            key={i}
            dnd={dnd}
            entry={entry}
            list={list}
            path={path}
          />
        );
      })}
    </>
  );
}

function DeeplinkField({
  list,
}: {
  list: ReturnType<typeof useDeeplinkListState>;
}) {
  const isEmpty = list.items.length === 0;
  const dnd = useDeeplinkDnD(list);

  return (
    <div className={styles.field}>
      {isEmpty ? (
        <EmptyState
          action={
            <div className={sectionStyles.deeplinkEmptyActions}>
              <Button
                leading={<Icons.PlusIcon size={10} />}
                size="sm"
                variant="secondary"
                onClick={() => list.addLink([])}
              >
                Add link
              </Button>
              <Button
                leading={<Icons.FolderIcon size={11} />}
                size="sm"
                variant="secondary"
                onClick={() => list.addFolder([])}
              >
                Add folder
              </Button>
            </div>
          }
          body="Group simulator deep links to fire from the runtime toolbar."
          className={sectionStyles.deeplinkEmptyState}
          icon={<Icons.LinkIcon size={20} />}
          title="No deep links yet"
        />
      ) : (
        <div className={sectionStyles.deeplinkTree}>
          <DeeplinkTree
            dnd={dnd}
            entries={list.items}
            list={list}
            parentPath={[]}
          />
          <DeeplinkAddRow root list={list} parentPath={[]} />
        </div>
      )}
    </div>
  );
}

function RelatedProjectField({
  list,
}: {
  list: ReturnType<typeof useRelatedProjectListState>;
}) {
  const handleAdd = list.add;

  return (
    <div className={styles.field}>
      {list.items.length === 0 ? (
        <EmptyState
          action={
            <Button
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              variant="ghost"
              onClick={handleAdd}
            >
              Add project
            </Button>
          }
          className={sectionStyles.inlineEmptyState}
          icon={<Icons.RepoIcon size={18} />}
          title="No related projects"
        />
      ) : (
        <div className={styles.listEditor}>
          {list.items.map((entry, i) => (
            <div key={i} className={sectionStyles.rowCard}>
              <Input
                placeholder="../other-repo"
                style={{ flex: 1 }}
                type="text"
                value={entry.path}
                onChange={(e) => list.update(i, "path", e.target.value)}
              />
              <Input
                placeholder="Short description for spawned agents"
                style={{ flex: 2 }}
                type="text"
                value={entry.description}
                onChange={(e) => list.update(i, "description", e.target.value)}
              />
              <button
                aria-label="Remove related project"
                className={[styles.removeBtn, sectionStyles.rowCardAction].join(
                  " ",
                )}
                onClick={() => list.remove(i)}
              >
                <Icons.CloseIcon size={12} />
              </button>
            </div>
          ))}
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            variant="ghost"
            onClick={handleAdd}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible disclosure                                             */
/* ------------------------------------------------------------------ */

interface CollapsibleProps {
  children: React.ReactNode;
  label: string;
}

function Collapsible({ label, children }: CollapsibleProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={sectionStyles.collapsible}>
      <button
        aria-expanded={open}
        className={sectionStyles.collapsibleTrigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <Icons.ChevronRightIcon
          className={[
            sectionStyles.collapsibleChevron,
            open ? sectionStyles.collapsibleChevronOpen : "",
          ]
            .filter(Boolean)
            .join(" ")}
          size={10}
        />
        {label}
      </button>
      {open && <div className={sectionStyles.collapsibleBody}>{children}</div>}
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
  // Excludes for `setup.copy` / `setup.symlink` entries are not editable in
  // the dialog (yet) — but we round-trip them so users who hand-author
  // `{ path, exclude }` entries in `.argus.json` don't silently lose the
  // excludes when they open + save the dialog.
  const copyExcludesRef = useRef<Map<string, string[]>>(new Map());
  const symlinkExcludesRef = useRef<Map<string, string[]>>(new Map());
  const commandList = useListState([]);
  const terminalList = useTerminalListState([]);
  const envList = useEnvListState([]);
  const browserPresetList = useBrowserPresetListState([]);
  const deeplinkList = useDeeplinkListState([]);
  const relatedProjectList = useRelatedProjectListState([]);
  const runList = useRunListState([]);
  const protectedBranchList = useListState([]);
  const releaseNotesList = useReleaseNotesListState([]);
  const [browserUrl, setBrowserUrl] = useState("");
  const [platforms, setPlatforms] = useState<RuntimePlatform[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [saveChatHistory, setSaveChatHistory] = useState(true);
  const [singleRuntime, setSingleRuntime] = useState(false);
  const [pullRequestTemplate, setPullRequestTemplate] = useState("");
  const [defaultBaseBranch, setDefaultBaseBranch] = useState("");
  const [minArgusVersion, setMinArgusVersion] = useState("");
  const [mcpEntries, setMcpEntries] = useState<McpEntry[]>([]);
  const [llmRunner, setLlmRunner] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [automations, setAutomations] = useState<ProjectAutomationConfig>({});
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
  const setDeeplinks = deeplinkList.setItems;
  const setRelatedProjects = relatedProjectList.setItems;
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
          const { paths, excludes } = splitSetupEntries(config.setup.copy);
          copyExcludesRef.current = excludes;
          setCopies(paths);
        }
        if (config.setup?.symlink?.length) {
          const { paths, excludes } = splitSetupEntries(config.setup.symlink);
          symlinkExcludesRef.current = excludes;
          setSymlinks(paths);
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
        if (config.default_base_branch) {
          setDefaultBaseBranch(config.default_base_branch);
        }
        if (config.min_argus_version) {
          setMinArgusVersion(config.min_argus_version);
        }
        if (config.mcp_servers) {
          setMcpEntries(mapToEntries(config.mcp_servers));
        }
        if (config.llm) {
          if (config.llm.runner) {
            setLlmRunner(config.llm.runner);
          }
          if (config.llm.model) {
            setLlmModel(config.llm.model);
          }
        }
        if (config.release_note_patterns?.length) {
          setReleaseNotes(patternsToEntries(config.release_note_patterns));
        }
        if (config.simulator_deeplinks?.length) {
          setDeeplinks(deeplinkConfigToEntries(config.simulator_deeplinks));
        }
        if (config.related_projects?.length) {
          setRelatedProjects(
            config.related_projects.map((rp: RelatedProject) => ({
              path: rp.path ?? "",
              description: rp.description ?? "",
            })),
          );
        }
        if (config.automations) {
          setAutomations(config.automations);
        }
        const rawDisabled = config.tools?.disabled ?? [];
        if (rawDisabled.length) {
          setDisabledTools(rawDisabled);
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
    setDeeplinks,
    setRelatedProjects,
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
      config.setup!.copy = mergeSetupEntries(copies, copyExcludesRef.current);
    }
    if (symlinks.length) {
      config.setup!.symlink = mergeSetupEntries(
        symlinks,
        symlinkExcludesRef.current,
      );
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
    const defaultBase = defaultBaseBranch.trim();
    if (defaultBase) {
      config.default_base_branch = defaultBase;
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
    const deeplinks = deeplinkEntriesToConfig(deeplinkList.items);
    if (deeplinks.length > 0) {
      config.simulator_deeplinks = deeplinks;
    }
    const relatedProjects = relatedProjectList.items
      .filter((rp) => rp.path.trim())
      .map((rp) => ({
        path: rp.path.trim(),
        description: rp.description.trim(),
      }));
    if (relatedProjects.length > 0) {
      config.related_projects = relatedProjects;
    }
    const trimmedRunner = llmRunner.trim();
    const trimmedModel = llmModel.trim();
    if (trimmedRunner || trimmedModel) {
      config.llm = {
        ...(trimmedRunner ? { runner: trimmedRunner } : {}),
        ...(trimmedModel ? { model: trimmedModel } : {}),
      };
    }

    if (disabledTools.length > 0) {
      config.tools = { disabled: [...disabledTools] };
    }

    const automationsConfig: ProjectAutomationConfig = {
      ...(automations.autonomy_ceiling
        ? { autonomy_ceiling: automations.autonomy_ceiling }
        : {}),
      ...(automations.path_denylist?.length
        ? { path_denylist: automations.path_denylist }
        : {}),
      ...(automations.disabled?.length
        ? { disabled: automations.disabled }
        : {}),
    };
    if (Object.keys(automationsConfig).length > 0) {
      config.automations = automationsConfig;
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
      defaultBaseBranch,
      minArgusVersion,
      mcpEntries,
      releaseNotesList.items,
      deeplinkList.items,
      relatedProjectList.items,
      llmRunner,
      llmModel,
      disabledTools,
      automations,
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
                    className={sectionStyles.fieldLabel}
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
                    Optional semver string. The project home screen warns
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
                  <div className={sectionStyles.platformsRow}>
                    {(
                      [
                        { id: "ios", chip: "ios" },
                        { id: "android", chip: "android" },
                        { id: "tvos", label: "tvOS" },
                        { id: "web", chip: "web" },
                      ] as const
                    ).map((p) => {
                      const active = platforms.includes(
                        p.id as RuntimePlatform,
                      );
                      const toggle = () =>
                        setPlatforms((prev) =>
                          active
                            ? prev.filter((x) => x !== p.id)
                            : [...prev, p.id as RuntimePlatform],
                        );

                      if ("chip" in p) {
                        return (
                          <PlatformChip
                            key={p.id}
                            active={active}
                            platform={p.chip}
                            onClick={toggle}
                          />
                        );
                      }

                      // tvOS — no dedicated PlatformChip variant, use Chip
                      return (
                        <Chip
                          key={p.id}
                          interactive
                          style={
                            active
                              ? {
                                  borderColor: "var(--accent-border-soft)",
                                  color: "var(--text-primary)",
                                  background: "var(--surface-5)",
                                }
                              : undefined
                          }
                          onClick={toggle}
                        >
                          <Icons.SimulatorIcon size={10} />
                          {p.label}
                        </Chip>
                      );
                    })}
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
                description="Entries shown in the run menu. Argus tracks each running command per session. Use 'Requires' chips to declare startup dependencies between commands."
                title="Run commands"
              />
              <SettingsScreenDetailBody>
                <RunCommandsField list={runList} />
                <label className={sectionStyles.singleRuntimeCheckbox}>
                  <input
                    checked={singleRuntime}
                    type="checkbox"
                    onChange={(e) => setSingleRuntime(e.target.checked)}
                  />
                  Only one runtime active at a time across this project
                </label>
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
                <TerminalField list={terminalList} repoRoot={repoRoot} />
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
                description="The web runtime panel loads this URL on first open and exposes the device presets in its picker. Width and height are CSS pixels."
                title="Browser"
              />
              <SettingsScreenDetailBody>
                <div className={styles.field}>
                  <label
                    className={sectionStyles.fieldLabel}
                    htmlFor="setup-browser-url"
                  >
                    Default URL
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
        {
          id: "deeplinks",
          label: "Deep links",
          description: "Simulator Link button",
          icon: <Icons.LinkIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Deep links surfaced by the runtime toolbar's Link dropdown when a simulator or emulator is connected. Each entry fires conductor open-link <url> against the device. Group related entries under folders — folders may contain folders."
                title="Simulator deep links"
              />
              <SettingsScreenDetailBody>
                <DeeplinkField list={deeplinkList} />
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

                <div className={styles.field}>
                  <label
                    className={sectionStyles.fieldLabel}
                    htmlFor="setup-default-base-branch"
                  >
                    Default source branch
                  </label>
                  <Input
                    id="setup-default-base-branch"
                    placeholder="staging"
                    type="text"
                    value={defaultBaseBranch}
                    onChange={(e) => setDefaultBaseBranch(e.target.value)}
                  />
                  <p className={styles.helpText}>
                    Branch preselected as the source when creating a new
                    session. When empty, Argus probes for <code>staging</code>,{" "}
                    <code>develop</code>, <code>dev</code>, <code>main</code>,
                    then <code>master</code>.
                  </p>
                </div>

                <Collapsible label="Advanced">
                  <div className={styles.field}>
                    <label
                      className={sectionStyles.fieldLabel}
                      htmlFor="setup-pr-template"
                    >
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
                </Collapsible>
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
                description="Additional instructions appended to every agent's system prompt, plus history and other agent-level options."
                title="Agent"
              />
              <SettingsScreenDetailBody>
                <div className={styles.field}>
                  <label
                    className={sectionStyles.fieldLabel}
                    htmlFor="setup-agent-prompt"
                  >
                    System prompt addition
                  </label>
                  <TextArea
                    id="setup-agent-prompt"
                    placeholder="Extra instructions appended to every agent's system prompt in this project..."
                    rows={6}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                  />
                </div>
                <label className={sectionStyles.agentCheckboxRow}>
                  <input
                    checked={saveChatHistory}
                    type="checkbox"
                    onChange={(e) => setSaveChatHistory(e.target.checked)}
                  />
                  Save chat history when agents stop
                </label>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "llm",
          label: "LLM",
          description: "Default runner & model",
          icon: <Icons.AgentIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Project-level default LLM runner and model. Used when an agent or session does not pin its own. The runner is bound at session creation; the model is re-resolved per agent spawn. Leave blank to fall back to your app-level default."
                title="LLM"
              />
              <SettingsScreenDetailBody>
                <SettingsScreenField
                  caption="The CLI/agent that drives sessions. Leave blank to fall back to your app-level default. Unknown ids also fall back to the app default."
                  label="Runner"
                >
                  <RunnerOptions selected={llmRunner} onChange={setLlmRunner} />
                </SettingsScreenField>
                <SettingsScreenField
                  caption="Default model id, in whatever shape the runner expects. Leave blank to let the runner pick."
                  label="Model"
                >
                  <Input
                    id="setup-llm-model"
                    placeholder="claude-opus-4-7"
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                  />
                </SettingsScreenField>
              </SettingsScreenDetailBody>
            </SettingsScreenDetail>
          ),
        },
        {
          id: "related-projects",
          label: "Related projects",
          description: "Cross-repo agent work",
          icon: <Icons.RepoIcon size={12} />,
          render: () => (
            <SettingsScreenDetail>
              <SettingsScreenDetailHeader
                description="Other repositories that agents in this project may spawn worktrees in. Paths are repo-root relative. Surfaced via the list_projects MCP tool."
                title="Related projects"
              />
              <SettingsScreenDetailBody>
                <RelatedProjectField list={relatedProjectList} />
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
        {
          id: "automations",
          label: "Automations",
          description: "Autonomy ceiling for this repo",
          icon: <Icons.GearIcon size={12} />,
          render: () => (
            <ProjectAutomationsField
              value={automations}
              onChange={setAutomations}
            />
          ),
        },
        {
          id: "tools",
          label: "Tools",
          description: "Mask off tools for this project",
          icon: <Icons.SimulatorIcon size={12} />,
          render: () => (
            <ProjectToolsField
              disabled={disabledTools}
              onChange={setDisabledTools}
            />
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
                  <label
                    className={sectionStyles.fieldLabel}
                    htmlFor="setup-branch-prefix"
                  >
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
                <CodeBlock code={previewJson} copyable language="json" />
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
      <DialogFooter>
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
      </DialogFooter>
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
