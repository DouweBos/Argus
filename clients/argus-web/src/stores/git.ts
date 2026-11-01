/** A session's git status and diffs. Mirrors `HostStore+Branches` (read side). */

import { create } from "zustand";
import type { RemoteGitStatus } from "../lib/protocol";
import { request } from "../lib/request";
import type { DiffMode } from "../routing/screens";
import { currentTransport } from "./connection";

interface GitState {
  /** Latest git status per session (badges + the changes header). */
  gitStatusBySession: Record<string, RemoteGitStatus>;

  loadGitStatus: (sessionId: string) => Promise<void>;
  loadDiff: (
    sessionId: string,
    mode: DiffMode,
  ) => Promise<{ diff: string; base_branch: string | null }>;
}

export const useGitStore = create<GitState>()((set) => ({
  gitStatusBySession: {},

  loadGitStatus: async (sessionId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { status } = await request(t, "sessions.git_status", {
        session_id: sessionId,
      });
      set((s) => ({
        gitStatusBySession: { ...s.gitStatusBySession, [sessionId]: status },
      }));
    } catch {
      // The session may be initialising or gone; leave any prior status.
    }
  },

  loadDiff: async (sessionId, mode) => {
    const t = currentTransport();
    if (!t) {
      return { diff: "", base_branch: null };
    }
    const { diff, base_branch } = await request(t, "sessions.diff", {
      session_id: sessionId,
      mode,
    });

    return { diff, base_branch: base_branch ?? null };
  },
}));

export function resetGit(): void {
  useGitStore.setState({ gitStatusBySession: {} });
}
