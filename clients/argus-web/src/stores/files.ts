/**
 * A session's files: the list behind @-mentions and quick open, reads for the
 * viewer, and the paths a session changed (ranked first). Mirrors
 * `FileSearchStore`'s neighbours in `HostStore`; searching lives in
 * `fileSearch.ts`.
 */

import { NOT_CONNECTED_MESSAGE } from "@argus/client-core";
import { parseDiff } from "@argus/peacock";
import { RemoteError } from "@argus/remote-client";
import type { CodeFile } from "@argus/remote-protocol";
import { create } from "zustand";
import type { RemoteMentionPathResult } from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

/** What quick open ranks: every file, and the ones this session changed. */
export interface FileIndex {
  files: string[];
  changed: string[];
}

interface FilesState {
  /** Per session, kept so reopening quick open is instant. */
  indexBySession: Record<string, FileIndex>;

  listFiles: (sessionId: string) => Promise<string[]>;
  resolveMentionPath: (
    sessionId: string,
    query: string,
  ) => Promise<RemoteMentionPathResult>;
  loadFileIndex: (sessionId: string) => Promise<FileIndex>;
  readFile: (sessionId: string, path: string) => Promise<CodeFile>;
}

export const useFilesStore = create<FilesState>()((set, get) => ({
  indexBySession: {},

  listFiles: async (sessionId) => {
    const t = currentTransport();
    if (!t) {
      return [];
    }
    const { files } = await request(t, "sessions.files", {
      session_id: sessionId,
    });

    return files;
  },

  resolveMentionPath: async (sessionId, query) => {
    const t = currentTransport();
    if (!t) {
      return { entries: [], resolved_path: "" };
    }

    return request(t, "sessions.resolve_mention_path", {
      session_id: sessionId,
      query,
    });
  },

  loadFileIndex: async (sessionId) => {
    const t = currentTransport();
    if (!t) {
      return get().indexBySession[sessionId] ?? { files: [], changed: [] };
    }
    const [files, diff] = await Promise.all([
      get().listFiles(sessionId),
      // Changed files only rank; a failed diff leaves the order alone.
      request(t, "sessions.diff", { session_id: sessionId, mode: "branch" })
        .then((r) => r.diff)
        .catch(() => ""),
    ]);
    const changed = parseDiff(diff)
      .filter((f) => f.status !== "D")
      .map((f) => f.newPath || f.oldPath);
    const index = { files, changed };
    set((s) => ({
      indexBySession: { ...s.indexBySession, [sessionId]: index },
    }));

    return index;
  },

  readFile: async (sessionId, path) => {
    const t = currentTransport();
    if (!t) {
      throw new RemoteError("offline", NOT_CONNECTED_MESSAGE);
    }

    return request(t, "files.read", { session_id: sessionId, path });
  },
}));

export function resetFiles(): void {
  useFilesStore.setState({ indexBySession: {} });
}
