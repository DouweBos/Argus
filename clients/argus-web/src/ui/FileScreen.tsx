/**
 * One session file, read-only and highlighted. `path` is as the link had it:
 * an absolute path is placed in the worktree by matching the session's file
 * list, as on the phone.
 */

import {
  CODE_LANGUAGE_NAMES,
  type CodeLanguage,
  describeError,
  detectCodeLanguage,
  directoryOf,
  needsFileList,
  relativeSessionPath,
} from "@argus/client-core";
import {
  Banner,
  Button,
  CodeViewer,
  EmptyState,
  Icons,
  Spinner,
} from "@argus/peacock";
import type { CodeFile, CodeReadOnlyReason } from "@argus/remote-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { takeFileSource } from "../routing/openFile";
import { useConnectionStore } from "../stores/connection";
import { useFilesStore } from "../stores/files";
import { capture } from "../telemetry/telemetry";

type Loaded =
  | { error: string; kind: "failed" }
  | { file: CodeFile; kind: "file"; path: string }
  | { kind: "loading" };

function readOnlyMessage(reason: CodeReadOnlyReason, size: number): string {
  switch (reason) {
    case "binary":
      return "This is a binary file.";
    case "encoding":
      return "This file isn't UTF-8 text.";
    case "too_large":
      return `This file is too large to show (${Math.round(size / 1024)} KB).`;
  }
}

function firstLine(content: string): string {
  const end = content.indexOf("\n");

  return end === -1 ? content : content.slice(0, end);
}

export function FileScreen({
  sessionId,
  path,
  line,
}: {
  sessionId: string;
  path: string;
  line: number | null;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const readFile = useFilesStore((s) => s.readFile);
  const loadFileIndex = useFilesStore((s) => s.loadFileIndex);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [wrap, setWrap] = useState(false);
  const reported = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const files = needsFileList(path)
        ? (await loadFileIndex(sessionId)).files
        : [];
      const relative = relativeSessionPath(path, files);
      if (!relative) {
        setLoaded({ kind: "failed", error: "This file isn't in the session's worktree." });

        return;
      }
      const file = await readFile(sessionId, relative);
      setLoaded({ kind: "file", file, path: relative });
    } catch (err) {
      setLoaded({ kind: "failed", error: describeError(err) });
    }
  }, [sessionId, path, readFile, loadFileIndex]);

  useEffect(() => {
    if (connection === "ready" && hasControl) {
      void load();
    }
  }, [connection, hasControl, load]);

  const shownPath = loaded.kind === "file" ? loaded.path : path;
  const language: CodeLanguage | null =
    loaded.kind === "file"
      ? detectCodeLanguage(shownPath, firstLine(loaded.file.content))
      : null;

  useEffect(() => {
    const key = `${sessionId}\u0000${path}`;
    if (loaded.kind !== "file" || reported.current === key) {
      return;
    }
    reported.current = key;
    capture("web_file_viewed", {
      source: takeFileSource(sessionId, path),
      language: language ?? "other",
    });
  }, [loaded, sessionId, path, language]);

  if (!hasControl) {
    return (
      <Banner tone="warning">
        Reading files needs control access. Pair this browser with control to
        open them.
      </Banner>
    );
  }
  if (loaded.kind === "loading") {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Opening file…</span>
      </div>
    );
  }
  if (loaded.kind === "failed") {
    return (
      <EmptyState
        icon={<Icons.FileIcon size={22} />}
        title="Can't open this file"
        body={loaded.error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        }
      />
    );
  }
  const { file } = loaded;
  if (file.readOnlyReason) {
    return (
      <EmptyState
        icon={<Icons.FileIcon size={22} />}
        title="Nothing to show"
        body={readOnlyMessage(file.readOnlyReason, file.size)}
      />
    );
  }
  const directory = directoryOf(shownPath);
  const subtitle = [directory, language ? CODE_LANGUAGE_NAMES[language] : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="aw-file">
      <div className="aw-file-bar">
        <span className="aw-muted aw-truncate" title={shownPath}>
          {subtitle || "Worktree root"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={wrap}
          onClick={() => setWrap((w) => !w)}
        >
          {wrap ? "No wrap" : "Wrap"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leading={<Icons.CopyIcon size={12} />}
          onClick={() => void navigator.clipboard?.writeText(shownPath)}
        >
          Path
        </Button>
      </div>
      <CodeViewer
        className="aw-file-code"
        code={file.content}
        focusLine={line}
        language={language}
        wrap={wrap}
      />
    </div>
  );
}
