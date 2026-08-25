/**
 * @-mention picker logic, ported from the web client and reshaped for RN: the
 * caller owns the text value + caret and passes them in, and `selectItem`
 * returns the next value/caret instead of mutating a DOM textarea. Search mode
 * filters the session's file list; browse mode (a query with `/`, `~`, or `.`)
 * lists a directory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../stores/appStore";

export interface MentionPickerItem {
  display: string;
  hint?: string;
  isDir: boolean;
  isLinkAction?: boolean;
}

interface MentionContext {
  query: string;
  startIndex: number;
}

export interface MentionEdit {
  value: string;
  cursor: number;
}

const MAX_RESULTS = 12;

function detectMention(value: string, cursorPos: number): MentionContext | null {
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

  return lower.includes(lowerQuery) ? 1 : 0;
}

export function useMentionPicker(sessionId: string | undefined) {
  const listFiles = useAppStore((s) => s.listFiles);
  const resolveMentionPath = useAppStore((s) => s.resolveMentionPath);
  const [sessionFiles, setSessionFiles] = useState<string[]>([]);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(
    null,
  );
  const [browseState, setBrowseState] = useState<{
    dirPath: string;
    entries: MentionPickerItem[];
  }>({ dirPath: "", entries: [] });
  const browseRequestRef = useRef(0);

  const sessionDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const file of sessionFiles) {
      let p = file;
      for (;;) {
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
        setBrowseState({
          dirPath,
          entries: [
            linkItem,
            ...result.entries.map((e) => ({ display: e.name, isDir: e.is_dir })),
          ],
        });
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
        .filter((e) => e.isLinkAction || e.display.toLowerCase().includes(filter))
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
      .map((d) => ({ display: fileBasename(d), hint: fileDirname(d), isDir: true }));

    const matchedFiles: MentionPickerItem[] = sessionFiles
      .filter((f) => f.toLowerCase().includes(q))
      .sort(
        (a, b) => scoreMatch(fileBasename(b), q) - scoreMatch(fileBasename(a), q),
      )
      .slice(0, MAX_RESULTS - matchedDirs.length)
      .map((f) => ({ display: fileBasename(f), hint: fileDirname(f), isDir: false }));

    return [...matchedDirs, ...matchedFiles];
  }, [mentionContext, browseState, sessionFiles, sessionDirs]);

  const updateMentions = useCallback((value: string, cursor: number) => {
    setMentionContext(detectMention(value, cursor));
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

      return item.hint ? `${item.hint}/${item.display}` : item.display;
    },
    [mentionContext],
  );

  /** Apply a pick to the current text; directories drill in, files insert. */
  const selectItem = useCallback(
    (value: string, index: number): MentionEdit | null => {
      const item = items[index];
      if (!mentionContext || !item) {
        return null;
      }
      const fullPath = resolveItemPath(item);
      const before = value.slice(0, mentionContext.startIndex);
      const after = value.slice(
        mentionContext.startIndex + 1 + mentionContext.query.length,
      );

      if (item.isDir && !item.isLinkAction) {
        const newQuery = `${fullPath}/`;
        setMentionContext({
          query: newQuery,
          startIndex: mentionContext.startIndex,
        });

        return {
          value: `${before}@${newQuery}${after}`,
          cursor: before.length + 1 + newQuery.length,
        };
      }

      const insertion = `@${fullPath} `;
      setMentionContext(null);

      return {
        value: `${before}${insertion}${after}`,
        cursor: before.length + insertion.length,
      };
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
    updateMentions,
    selectItem,
    dismissMention,
    headerText,
  };
}
