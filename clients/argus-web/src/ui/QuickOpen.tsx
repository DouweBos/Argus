/**
 * Quick open over a session's files: the Cmd/Ctrl+P palette and the Files
 * screen are the same list. `:<line>` jumps within the file on screen.
 */

import {
  type FuzzyMatch,
  parseQuickOpenQuery,
  splitMatchedPath,
} from "@argus/client-core";
import {
  Badge,
  Banner,
  Icons,
  type PaletteGroup,
  PaletteDialog,
  type PaletteItem,
} from "@argus/peacock";
import { useEffect, useRef, useState } from "react";
import { openFile } from "../routing/openFile";
import { appNavigate } from "../routing/router";
import { useConnectionStore } from "../stores/connection";
import { capture } from "../telemetry/telemetry";
import type { QuickOpenVia } from "../telemetry/events";
import { useFileMatches } from "./useFileMatches";

const LINE_ITEM = "line";

function fileItem(match: FuzzyMatch): PaletteItem {
  const parts = splitMatchedPath(match.path, match.indices);

  return {
    id: match.path,
    icon: <Icons.FileIcon size={13} />,
    title: parts.name,
    titleMatches: parts.nameIndices,
    sublabel: parts.directory || undefined,
    sublabelMatches: parts.directoryIndices,
    badge: match.isBoosted ? (
      <Badge size="tag" tone="accent">
        changed
      </Badge>
    ) : undefined,
  };
}

function emptyText(
  goingToLine: boolean,
  currentFile: string | null | undefined,
  fileCount: number,
  text: string,
): string {
  if (goingToLine) {
    return currentFile ? "Type a line number." : "Open a file first to go to a line.";
  }

  return fileCount === 0
    ? "This session has no files."
    : `Nothing in this worktree matches “${text}”.`;
}

export function QuickOpen({
  sessionId,
  via,
  currentFile,
  onClose,
}: {
  sessionId: string;
  via: QuickOpenVia;
  /** The file on screen, which `:<line>` moves within. */
  currentFile?: string | null;
  /** Set for the palette; the screen has nothing to close. */
  onClose?: () => void;
}) {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const [query, setQuery] = useState("");
  const parsed = parseQuickOpenQuery(query, "files");
  const text = parsed.kind === "files" ? parsed.text : "";
  const { matches, loading, error, fileCount } = useFileMatches(sessionId, text);
  const picked = useRef(false);

  // One event per palette shown; the screen counts once per pick.
  useEffect(() => {
    if (via !== "shortcut") {
      return;
    }

    return () => capture("web_quick_open_used", { via, picked: picked.current });
  }, [via]);

  if (!hasControl) {
    return (
      <Banner tone="warning">
        Browsing files needs control access. Pair this browser with control
        to open them.
      </Banner>
    );
  }

  const groups: PaletteGroup[] =
    parsed.kind === "line"
      ? [
          {
            key: "line",
            items:
              currentFile && parsed.line
                ? [
                    {
                      id: LINE_ITEM,
                      icon: <Icons.ArrowForwardIcon size={13} />,
                      title: `Go to line ${parsed.line}`,
                    },
                  ]
                : [],
          },
        ]
      : [{ key: "files", items: matches.map(fileItem) }];

  const onSelect = (item: PaletteItem) => {
    picked.current = true;
    if (via === "screen") {
      capture("web_quick_open_used", { via, picked: true });
    }
    onClose?.();
    if (item.id === LINE_ITEM && currentFile && parsed.kind === "line") {
      appNavigate(
        { name: "file", sessionId, path: currentFile, line: parsed.line },
        { replace: true },
      );

      return;
    }
    openFile(sessionId, item.id, "quick_open");
  };

  const emptyLabel = error ?? emptyText(parsed.kind === "line", currentFile, fileCount, text);

  return (
    <PaletteDialog
      ariaLabel="Open a file"
      autoFocus={via === "shortcut" || window.matchMedia("(pointer: fine)").matches}
      emptyLabel={emptyLabel}
      groups={groups}
      inline={via === "screen"}
      loading={loading && parsed.kind !== "line"}
      placeholder="Search files by name"
      query={query}
      onClose={onClose}
      onQueryChange={setQuery}
      onSelect={onSelect}
    />
  );
}
