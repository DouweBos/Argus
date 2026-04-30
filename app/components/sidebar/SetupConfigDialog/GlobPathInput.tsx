import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Input } from "@argus/peacock";
import { listPath } from "../../../lib/ipc";
import {
  FileMentionPicker,
  type MentionPickerItem,
} from "../../shared/FileMentionPicker";
import styles from "./GlobPathInput.module.css";

interface GlobPathInputProps {
  id?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Absolute path to the repo root — used as the autocomplete root. */
  repoRoot: string;
  style?: React.CSSProperties;
  value: string;
}

/**
 * `<Input>` paired with the same `FileMentionPicker` popup ChatInput uses
 * for `@`-mentions, but driven by every keystroke (no `@` trigger) and
 * with the "Link directory" action row omitted — there's no agent context
 * to link to from the project-settings dialog.
 *
 * The literal prefix (everything before the first glob metacharacter
 * `*?[`) of the value is used as the autocomplete root: typing
 * `apps/foo/relea` lists the contents of `apps/foo/`. Selecting a directory
 * descends into it; selecting a file replaces the prefix with that file's
 * full path.
 */
export function GlobPathInput({
  id,
  onChange,
  placeholder,
  repoRoot,
  style,
  value,
}: GlobPathInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const inputRef = useRef<HTMLInputElement>(null);

  const literalPrefix = useMemo(() => literalPrefixOf(value), [value]);
  const dirPrefix = useMemo(
    () => literalPrefix.slice(0, literalPrefix.lastIndexOf("/") + 1),
    [literalPrefix],
  );
  const filterText = useMemo(
    () => literalPrefix.slice(dirPrefix.length).toLowerCase(),
    [literalPrefix, dirPrefix],
  );

  const [entries, setEntries] = useState<{ isDir: boolean; name: string }[]>(
    [],
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!repoRoot) {
      return;
    }
    let cancelled = false;
    const target = dirPrefix ? `${repoRoot}/${dirPrefix}` : repoRoot;
    listPath(target)
      .then((res) => {
        if (cancelled) {
          return;
        }
        setEntries(res.map((e) => ({ name: e.name, isDir: e.is_dir })));
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, dirPrefix]);

  // Filter + map to the picker's item shape. No `isLinkAction` rows — the
  // dialog has no agent context to link a directory to.
  const items = useMemo<MentionPickerItem[]>(() => {
    const matched = filterText
      ? entries.filter((e) => e.name.toLowerCase().includes(filterText))
      : entries;

    return matched.map((e) => ({ display: e.name, isDir: e.isDir }));
  }, [entries, filterText]);

  // Clamp the stored index against the current item count instead of
  // resetting it via an effect. Keeps the UI consistent without writing
  // state during render.
  const effectiveIndex =
    items.length === 0 ? 0 : Math.min(selectedIndex, items.length - 1);

  const headerText = dirPrefix || "/";

  const applySelection = (index: number) => {
    const item = items[index];
    if (!item) {
      return;
    }

    if (item.isDir) {
      // Descend into the directory. Preserve any glob suffix the user
      // already typed past the literal prefix (e.g. `*.md`) so the tail
      // survives the navigation.
      const newPrefix = `${dirPrefix}${item.display}/`;
      const trailing = value.slice(literalPrefix.length);
      onChange(newPrefix + trailing);
      // Keep the picker open so the user can keep descending.
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());

      return;
    }

    // File selection in a glob input means "I want everything like this
    // file" — turn it into a `<dir>/*<ext>` pattern instead of the
    // literal path. Files with no extension fall back to `<dir>/*`.
    onChange(`${dirPrefix}${globFromFilename(item.display)}`);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || items.length === 0) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }

      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applySelection(effectiveIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className={styles.wrap} style={style}>
      <Input
        autoComplete="off"
        id={inputId}
        placeholder={placeholder}
        ref={inputRef}
        spellCheck={false}
        type="text"
        value={value}
        onBlur={() => {
          // Delay so a click on a picker item still fires its onMouseDown
          // before the popup unmounts.
          setTimeout(() => setIsOpen(false), 100);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <FileMentionPicker
          headerText={headerText}
          items={items}
          placement="below"
          selectedIndex={effectiveIndex}
          onSelect={applySelection}
          onSelectedIndexChange={setSelectedIndex}
        />
      )}
    </div>
  );
}

/**
 * Turn a filename into a `*`-prefixed glob preserving its extension. A
 * dotfile like `.gitignore` is treated as having no extension (the leading
 * dot is part of the name, not an extension separator) and matches as
 * `.gitignore` literally — a `*` glob there would be misleading. Files
 * with multiple dots (e.g. `App.module.css`) keep only the final
 * extension so `*.css` is the suggestion, not `*.module.css`.
 */
function globFromFilename(filename: string): string {
  if (filename.startsWith(".") && !filename.slice(1).includes(".")) {
    return filename;
  }
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) {
    return "*";
  }

  return `*${filename.slice(lastDot)}`;
}

/** Substring up to (but not including) the first glob metacharacter. */
function literalPrefixOf(input: string): string {
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "*" || ch === "?" || ch === "[") {
      return input.slice(0, i);
    }
  }

  return input;
}
