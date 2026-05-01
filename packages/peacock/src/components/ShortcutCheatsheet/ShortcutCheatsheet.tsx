import { useId, useMemo, useState } from "react";
import { Dialog } from "../Dialog/Dialog";
import { Input } from "../Input/Input";
import { Kbd } from "../Kbd/Kbd";
import styles from "./ShortcutCheatsheet.module.css";

export type ShortcutScope = "project" | "session";

export interface ShortcutCheatsheetEntry {
  combo: string;
  contexts: readonly string[];
  id: string;
  label: string;
  scopes: readonly ShortcutScope[];
}

export interface ShortcutCheatsheetProps {
  onClose: () => void;
  open: boolean;
  scope: ShortcutScope;
  shortcuts: readonly ShortcutCheatsheetEntry[];
}

const CONTEXT_ORDER: readonly { id: string; label: string }[] = [
  { id: "global", label: "Global" },
  { id: "working-copy", label: "Working Copy" },
  { id: "history", label: "History" },
  { id: "stashes", label: "Stashes" },
  { id: "commit-composer", label: "Commit Composer" },
  { id: "conflicts", label: "Conflicts" },
];

/**
 * Render a combo string ("Cmd+Shift+E", "Opt+Cmd+Right") as styled `<kbd>`
 * elements. Symbol substitutions match macOS conventions.
 */
function comboKeys(combo: string): string[] {
  return combo.split("+").map((part) => {
    const trimmed = part.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "cmd" || lower === "meta") {
      return "⌘";
    }
    if (lower === "shift") {
      return "⇧";
    }
    if (lower === "opt" || lower === "option" || lower === "alt") {
      return "⌥";
    }
    if (lower === "ctrl") {
      return "⌃";
    }
    if (lower === "enter" || lower === "return") {
      return "⏎";
    }
    if (lower === "right") {
      return "→";
    }
    if (lower === "left") {
      return "←";
    }
    if (lower === "up") {
      return "↑";
    }
    if (lower === "down") {
      return "↓";
    }
    if (lower === "esc" || lower === "escape") {
      return "Esc";
    }

    return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
  });
}

interface Group {
  id: string;
  label: string;
  rows: ShortcutCheatsheetEntry[];
}

function groupShortcuts(
  list: readonly ShortcutCheatsheetEntry[],
  scope: ShortcutScope,
  query: string,
): Group[] {
  const q = query.trim().toLowerCase();
  const inScope = list.filter((s) => s.scopes.includes(scope));
  const filtered = q
    ? inScope.filter(
        (s) =>
          s.combo.toLowerCase().includes(q) ||
          s.label.toLowerCase().includes(q),
      )
    : inScope;

  const seen = new Set<string>();
  const groups: Group[] = [];
  for (const ctx of CONTEXT_ORDER) {
    const rows = filtered.filter((s) => s.contexts.includes(ctx.id));
    if (rows.length === 0) {
      continue;
    }
    // Drop duplicates that have already shown up in a higher-priority group
    // (e.g. `focus-commit` appears under both Working Copy and Commit Composer).
    const deduped = rows.filter((r) => {
      if (seen.has(r.id)) {
        return false;
      }
      seen.add(r.id);

      return true;
    });
    if (deduped.length > 0) {
      groups.push({ id: ctx.id, label: ctx.label, rows: deduped });
    }
  }

  return groups;
}

/**
 * Modal listing every keyboard shortcut grouped by context. Filterable by
 * combo or label. Scope-aware so project- vs. session-only shortcuts are
 * hidden when the other surface is active. Esc / click-outside close (the
 * underlying `<Dialog>` handles both).
 */
export function ShortcutCheatsheet({
  open,
  shortcuts,
  scope,
  onClose,
}: ShortcutCheatsheetProps) {
  const [query, setQuery] = useState("");
  const titleId = useId();

  const groups = useMemo(
    () => groupShortcuts(shortcuts, scope, query),
    [shortcuts, scope, query],
  );

  if (!open) {
    return null;
  }

  return (
    <Dialog
      onClose={onClose}
      size="medium"
      title="Keyboard shortcuts"
      titleId={titleId}
    >
      <div className={styles.body}>
        <Input
          autoFocus
          aria-label="Filter shortcuts"
          placeholder="Filter by combo or action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.scroll}>
          {groups.length === 0 ? (
            <div className={styles.empty}>No shortcuts match.</div>
          ) : (
            groups.map((group) => (
              <section key={group.id} className={styles.group}>
                <h3 className={styles.groupTitle}>{group.label}</h3>
                <ul className={styles.list}>
                  {group.rows.map((row) => (
                    <li key={row.id} className={styles.row}>
                      <span className={styles.combo}>
                        <Kbd keys={comboKeys(row.combo)} />
                      </span>
                      <span className={styles.label}>{row.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
