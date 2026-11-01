/** A session's files, for the composer's @-mentions. Mirrors `FileSearchStore`. */

import { create } from "zustand";
import type { RemoteMentionPathResult } from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

interface FilesState {
  listFiles: (sessionId: string) => Promise<string[]>;
  resolveMentionPath: (
    sessionId: string,
    query: string,
  ) => Promise<RemoteMentionPathResult>;
}

export const useFilesStore = create<FilesState>()(() => ({
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
}));
