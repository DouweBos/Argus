import type { MentionPickerItem } from "../../shared/FileMentionPicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listSessionFiles, resolveMentionPath } from "../../../lib/ipc";

// Re-export so existing `import { MentionPickerItem } from "./useMentionPicker"`
// sites keep working — the canonical definition lives next to the picker.
export type { MentionPickerItem };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MentionContext {
  query: string;
  startIndex: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESULTS = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect an @-mention trigger by searching backward from the cursor.
 *
 * Returns the mention context if the cursor is inside a valid `@token`
 * (preceded by whitespace or at position 0, no spaces in the token).
 */
function detectMention(
  value: string,
  cursorPos: number,
): MentionContext | null {
  const before = value.slice(0, cursorPos);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }

  // @ must be at start of input or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1])) {
    return null;
  }

  // Text between @ and cursor must not contain spaces
  const query = before.slice(atIndex + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return { query, startIndex: atIndex };
}

/** Whether a query should trigger browse mode (directory listing). */
function isBrowseQuery(query: string): boolean {
  return query.includes("/") || query.startsWith("~") || query.startsWith(".");
}

/**
 * Split a browse query into the directory portion and the filter suffix.
 * e.g. "src/components/App" → { dirPath: "src/components/", filter: "app" }
 *      "src/" → { dirPath: "src/", filter: "" }
 *      "~/Work" → { dirPath: "~/", filter: "work" }
 */
function splitBrowseQuery(query: string): {
  dirPath: string;
  filter: string;
} {
  const lastSlash = query.lastIndexOf("/");
  if (lastSlash === -1) {
    // Query like "~Work" or ".gitignore"
    if (query === "~" || query === ".") {
      return { dirPath: query, filter: "" };
    }

    if (query.startsWith("~")) {
      return { dirPath: "~/", filter: query.slice(1).toLowerCase() };
    }

    return { dirPath: "./", filter: query.slice(1).toLowerCase() };
  }

  return {
    dirPath: query.slice(0, lastSlash + 1),
    filter: query.slice(lastSlash + 1).toLowerCase(),
  };
}

function fileBasename(filePath: string): string {
  const i = filePath.lastIndexOf("/");

  return i === -1 ? filePath : filePath.slice(i + 1);
}

function fileDirname(filePath: string): string {
  const i = filePath.lastIndexOf("/");

  return i === -1 ? "" : filePath.slice(0, i);
}

/**
 * Rank a candidate against a lowercase query. Higher is better.
 * Case-insensitive at every step so users get the same results regardless
 * of how they typed the query.
 */
function scoreMatch(candidate: string, lowerQuery: string): number {
  if (!lowerQuery) {
    return 0;
  }

  const lower = candidate.toLowerCase();
  if (lower === lowerQuery) {
    return 3;
  }

  if (lower.startsWith(lowerQuery)) {
    return 2;
  }

  if (lower.includes(lowerQuery)) {
    return 1;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMentionPicker(sessionId: string | undefined) {
  const [sessionFiles, setSessionFiles] = useState<string[]>([]);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Browse mode: directory entries fetched from backend
  const [browseState, setBrowseState] = useState<{
    dirPath: string;
    entries: MentionPickerItem[];
  }>({ dirPath: "", entries: [] });
  const browseRequestRef = useRef(0);

  // Derive unique directory paths from the file list (for search mode)
  const sessionDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const file of sessionFiles) {
      let p = file;
      while (true) {
        const slash = p.lastIndexOf("/");
        if (slash === -1) {
          break;
        }

        p = p.slice(0, slash);
        if (dirs.has(p)) {
          break;
        }

        dirs.add(p);
      }
    }

    return Array.from(dirs).sort();
  }, [sessionFiles]);

  // Load session files when session changes
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    listSessionFiles(sessionId)
      .then(setSessionFiles)
      .catch(() => setSessionFiles([]));
  }, [sessionId]);

  // Fetch directory entries for browse mode (async only — no sync setState)
  useEffect(() => {
    if (!mentionContext || !sessionId || !isBrowseQuery(mentionContext.query)) {
      return;
    }

    const { dirPath } = splitBrowseQuery(mentionContext.query);

    // Skip refetch if we already have entries for this directory
    if (browseState.dirPath === dirPath) {
      return;
    }

    const requestId = ++browseRequestRef.current;

    resolveMentionPath(sessionId, dirPath)
      .then((result) => {
        if (requestId !== browseRequestRef.current) {
          return;
        }

        const linkItem: MentionPickerItem = {
          display: dirPath.replace(/\/+$/, "") || "/",
          isDir: true,
          isLinkAction: true,
        };

        const entryItems: MentionPickerItem[] = result.entries.map((e) => ({
          display: e.name,
          isDir: e.is_dir,
        }));

        setBrowseState({ dirPath, entries: [linkItem, ...entryItems] });
      })
      .catch(() => {
        if (requestId === browseRequestRef.current) {
          setBrowseState({ dirPath, entries: [] });
        }
      });
  }, [mentionContext, sessionId, browseState.dirPath]);

  // Derive final items list (no setState — pure computation)
  const items = useMemo((): MentionPickerItem[] => {
    if (!mentionContext) {
      return [];
    }

    if (isBrowseQuery(mentionContext.query)) {
      const { dirPath, filter } = splitBrowseQuery(mentionContext.query);

      // Only show browse results if they match the current directory
      if (browseState.dirPath !== dirPath) {
        return [];
      }

      if (!filter) {
        return browseState.entries;
      }

      return browseState.entries
        .filter(
          (e) => e.isLinkAction || e.display.toLowerCase().includes(filter),
        )
        .sort((a, b) => {
          if (a.isLinkAction !== b.isLinkAction) {
            return a.isLinkAction ? -1 : 1;
          }

          return scoreMatch(b.display, filter) - scoreMatch(a.display, filter);
        });
    }

    // Search mode: filter session files + directories (case-insensitive)
    const q = mentionContext.query.toLowerCase();
    const matchedDirs: MentionPickerItem[] = sessionDirs
      .filter((d) => d.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          scoreMatch(fileBasename(b), q) - scoreMatch(fileBasename(a), q),
      )
      .slice(0, 6)
      .map((d) => ({
        display: fileBasename(d),
        hint: fileDirname(d),
        isDir: true,
      }));

    const matchedFiles: MentionPickerItem[] = sessionFiles
      .filter((f) => f.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          scoreMatch(fileBasename(b), q) - scoreMatch(fileBasename(a), q),
      )
      .slice(0, MAX_RESULTS - matchedDirs.length)
      .map((f) => ({
        display: fileBasename(f),
        hint: fileDirname(f),
        isDir: false,
      }));

    return [...matchedDirs, ...matchedFiles];
  }, [mentionContext, browseState, sessionFiles, sessionDirs]);

  const updateMentions = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) {
      setMentionContext(null);

      return;
    }

    const ctx = detectMention(
      textarea.value,
      textarea.selectionStart ?? textarea.value.length,
    );
    if (!ctx) {
      setMentionContext(null);

      return;
    }

    setMentionContext(ctx);
    setSelectedIndex(0);
  }, []);

  /** Resolve the full path string to insert for a given item. */
  const resolveItemPath = useCallback(
    (item: MentionPickerItem): string => {
      if (!mentionContext) {
        return item.display;
      }

      if (isBrowseQuery(mentionContext.query)) {
        const { dirPath } = splitBrowseQuery(mentionContext.query);

        if (item.isLinkAction) {
          return dirPath.replace(/\/+$/, "") || "/";
        }

        return dirPath + item.display;
      }

      // Search mode: reconstruct full path
      if (item.hint) {
        return `${item.hint}/${item.display}`;
      }

      return item.display;
    },
    [mentionContext],
  );

  /**
   * Handle selecting an item. Directories navigate deeper (updating the
   * textarea query to end with `/`). Files and link-actions insert the path.
   */
  const selectItem = useCallback(
    (textarea: HTMLTextAreaElement | null, index: number) => {
      const item = items[index];
      if (!textarea || !mentionContext || !item) {
        return;
      }

      const fullPath = resolveItemPath(item);

      if (item.isDir && !item.isLinkAction) {
        // Navigate into the directory — update the textarea query
        const before = textarea.value.slice(0, mentionContext.startIndex);
        const after = textarea.value.slice(
          mentionContext.startIndex + 1 + mentionContext.query.length,
        );

        const newQuery = `${fullPath}/`;
        textarea.value = `${before}@${newQuery}${after}`;

        const newCursor = before.length + 1 + newQuery.length;
        textarea.selectionStart = newCursor;
        textarea.selectionEnd = newCursor;
        textarea.focus();

        setMentionContext({
          query: newQuery,
          startIndex: mentionContext.startIndex,
        });
        setSelectedIndex(0);
      } else {
        // Insert the path and close
        const before = textarea.value.slice(0, mentionContext.startIndex);
        const after = textarea.value.slice(
          mentionContext.startIndex + 1 + mentionContext.query.length,
        );

        const insertion = `@${fullPath} `;
        textarea.value = `${before}${insertion}${after}`;

        const newCursor = before.length + insertion.length;
        textarea.selectionStart = newCursor;
        textarea.selectionEnd = newCursor;
        textarea.focus();

        setMentionContext(null);
      }
    },
    [items, mentionContext, resolveItemPath],
  );

  const dismissMention = useCallback(() => {
    setMentionContext(null);
  }, []);

  /** The header text for the picker. */
  const headerText = useMemo(() => {
    if (!mentionContext || !isBrowseQuery(mentionContext.query)) {
      return "Files";
    }

    const { dirPath } = splitBrowseQuery(mentionContext.query);

    return dirPath;
  }, [mentionContext]);

  return {
    mentionContext,
    items,
    selectedIndex,
    setSelectedIndex,
    updateMentions,
    selectItem,
    dismissMention,
    headerText,
  };
}
