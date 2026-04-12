import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listWorkspaceFiles, resolveMentionPath } from "../../../lib/ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MentionContext {
  query: string;
  startIndex: number;
}

export interface MentionPickerItem {
  /** Display name (filename or directory name). */
  display: string;
  /** Secondary hint text (parent path in search mode). */
  hint?: string;
  /** Whether this entry is a directory. */
  isDir: boolean;
  /** Special "link this directory" action row. */
  isLinkAction?: boolean;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMentionPicker(workspaceId: string | undefined) {
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
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
  const workspaceDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const file of workspaceFiles) {
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
  }, [workspaceFiles]);

  // Load workspace files when workspace changes
  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    listWorkspaceFiles(workspaceId)
      .then(setWorkspaceFiles)
      .catch(() => setWorkspaceFiles([]));
  }, [workspaceId]);

  // Fetch directory entries for browse mode (async only — no sync setState)
  useEffect(() => {
    if (
      !mentionContext ||
      !workspaceId ||
      !isBrowseQuery(mentionContext.query)
    ) {
      return;
    }

    const { dirPath } = splitBrowseQuery(mentionContext.query);

    // Skip refetch if we already have entries for this directory
    if (browseState.dirPath === dirPath) {
      return;
    }

    const requestId = ++browseRequestRef.current;

    resolveMentionPath(workspaceId, dirPath)
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
  }, [mentionContext, workspaceId, browseState.dirPath]);

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

      return browseState.entries.filter(
        (e) => e.isLinkAction || e.display.toLowerCase().includes(filter),
      );
    }

    // Search mode: filter workspace files + directories
    const q = mentionContext.query.toLowerCase();
    const matchedDirs: MentionPickerItem[] = workspaceDirs
      .filter((d) => d.toLowerCase().includes(q))
      .slice(0, 6)
      .map((d) => ({
        display: fileBasename(d),
        hint: fileDirname(d),
        isDir: true,
      }));

    const matchedFiles: MentionPickerItem[] = workspaceFiles
      .filter((f) => f.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS - matchedDirs.length)
      .map((f) => ({
        display: fileBasename(f),
        hint: fileDirname(f),
        isDir: false,
      }));

    return [...matchedDirs, ...matchedFiles];
  }, [mentionContext, browseState, workspaceFiles, workspaceDirs]);

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
