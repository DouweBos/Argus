/**
 * @-mention picker logic ported from the desktop's `useMentionPicker`, wired to
 * the remote gateway (sessions.files / sessions.resolve_mention_path) via the
 * store instead of the desktop IPC. Search mode filters the session's file
 * list; browse mode (a query with `/`, `~`, or `.`) lists a directory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MentionPickerItem } from "@argus/peacock";
import { useFilesStore } from "../stores/files";

// Re-export so callers keep importing the row shape from the hook they use.
export type { MentionPickerItem };

interface MentionContext {
  query: string;
  startIndex: number;
}

const MAX_RESULTS = 12;

function detectMention(
  value: string,
  cursorPos: number,
): MentionContext | null {
  const before = value.slice(0, cursorPos);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1])) {
    return null;
  }
  const query = before.slice(atIndex + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return { query, startIndex: atIndex };
}

function isBrowseQuery(query: string): boolean {
  return query.includes("/") || query.startsWith("~") || query.startsWith(".");
}

function splitBrowseQuery(query: string): { dirPath: string; filter: string } {
  const lastSlash = query.lastIndexOf("/");
  if (lastSlash === -1) {
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

export function useMentionPicker(sessionId: string | undefined) {
  const listFiles = useFilesStore((s) => s.listFiles);
  const resolveMentionPath = useFilesStore((s) => s.resolveMentionPath);
  const [sessionFiles, setSessionFiles] = useState<string[]>([]);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [browseState, setBrowseState] = useState<{
    dirPath: string;
    entries: MentionPickerItem[];
  }>({ dirPath: "", entries: [] });
  const browseRequestRef = useRef(0);

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

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    listFiles(sessionId)
      .then(setSessionFiles)
      .catch(() => setSessionFiles([]));
  }, [sessionId, listFiles]);

  useEffect(() => {
    if (!mentionContext || !sessionId || !isBrowseQuery(mentionContext.query)) {
      return;
    }
    const { dirPath } = splitBrowseQuery(mentionContext.query);
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
  }, [mentionContext, sessionId, browseState.dirPath, resolveMentionPath]);

  const items = useMemo((): MentionPickerItem[] => {
    if (!mentionContext) {
      return [];
    }
    if (isBrowseQuery(mentionContext.query)) {
      const { dirPath, filter } = splitBrowseQuery(mentionContext.query);
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

    const q = mentionContext.query.toLowerCase();
    const matchedDirs: MentionPickerItem[] = sessionDirs
      .filter((d) => d.toLowerCase().includes(q))
      .sort(
        (a, b) => scoreMatch(fileBasename(b), q) - scoreMatch(fileBasename(a), q),
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
        (a, b) => scoreMatch(fileBasename(b), q) - scoreMatch(fileBasename(a), q),
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
      if (item.hint) {
        return `${item.hint}/${item.display}`;
      }

      return item.display;
    },
    [mentionContext],
  );

  const selectItem = useCallback(
    (textarea: HTMLTextAreaElement | null, index: number) => {
      const item = items[index];
      if (!textarea || !mentionContext || !item) {
        return;
      }
      const fullPath = resolveItemPath(item);
      if (item.isDir && !item.isLinkAction) {
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

  const dismissMention = useCallback(() => setMentionContext(null), []);

  const headerText = useMemo(() => {
    if (!mentionContext || !isBrowseQuery(mentionContext.query)) {
      return "Files";
    }

    return splitBrowseQuery(mentionContext.query).dirPath;
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
