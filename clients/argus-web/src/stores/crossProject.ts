/**
 * Cross-project sessions: give a session a worktree of other projects on its
 * branch. The computer counts it (`cross_project_session_created`).
 */

import { NOT_CONNECTED_MESSAGE } from "@argus/client-core";
import { RemoteError } from "@argus/remote-client";
import type { ResultOf } from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";
import { useProjectsStore } from "./projects";

export type CrossProjectResult = ResultOf<"sessions.make_cross_project">;

/** Throws the computer's reason when nothing could be added. */
export async function makeCrossProject(
  sessionId: string,
  repoRoots: string[],
): Promise<CrossProjectResult["failed"]> {
  const t = currentTransport();
  if (!t) {
    throw new RemoteError("offline", NOT_CONNECTED_MESSAGE);
  }
  const result = await request(t, "sessions.make_cross_project", {
    id: sessionId,
    repo_roots: repoRoots,
  });
  const { loadSessions } = useProjectsStore.getState();
  await Promise.all(
    [...new Set([...repoRoots, result.session.repo_root])].map((root) =>
      loadSessions(root).catch(() => {}),
    ),
  );

  return result.failed;
}
