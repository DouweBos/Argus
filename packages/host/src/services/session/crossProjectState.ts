/**
 * The persisted shape of a cross-project session: the primary session keeps
 * `linked_repos`, each linked repo's own session `cross_project_of`. Both stay
 * absent on a single-repo session, so its metadata and wire form are unchanged.
 */

import type { Session } from "./models";
import type { SessionLinkedRepo } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { loadMetadata, saveMetadata, type SessionMeta } from "./metadata";

type CrossProjectFields = Pick<Session, "cross_project_of" | "linked_repos">;

/** The two fields as they are written: only when set. */
export function crossProjectFields(
  source: CrossProjectFields,
): CrossProjectFields {
  return {
    ...(source.linked_repos?.length
      ? { linked_repos: source.linked_repos }
      : {}),
    ...(source.cross_project_of
      ? { cross_project_of: source.cross_project_of }
      : {}),
  };
}

/** Copy the persisted fields onto a listed session, clearing stale ones. */
export function applyCrossProject(
  target: Session,
  source: CrossProjectFields | SessionMeta,
): void {
  delete target.linked_repos;
  delete target.cross_project_of;
  Object.assign(target, crossProjectFields(source));
}

/** Whether the session is part of a cross-project session, either end. */
export function isCrossProject(session: CrossProjectFields): boolean {
  return Boolean(session.linked_repos?.length || session.cross_project_of);
}

/** The cross-project session `session` belongs to: itself, or its primary. */
export function crossProjectPrimary(session: Session): Session | null {
  if (session.linked_repos?.length) {
    return session;
  }

  return session.cross_project_of
    ? (appState.sessions.get(session.cross_project_of) ?? null)
    : null;
}

/** Replace the primary's linked repos in memory and in its repo's index, and tell the clients. */
export function setLinkedRepos(
  primary: Session,
  linked: SessionLinkedRepo[],
): void {
  if (linked.length > 0) {
    primary.linked_repos = linked;
  } else {
    delete primary.linked_repos;
  }
  appState.sessions.set(primary.id, primary);
  if (primary.path) {
    const meta = loadMetadata(primary.repo_root);
    const key = [...meta.keys()].find((k) => meta.get(k)?.id === primary.id);
    const entry = key ? meta.get(key) : undefined;
    if (key && entry) {
      const next: SessionMeta = { ...entry };
      delete next.linked_repos;
      meta.set(key, { ...next, ...crossProjectFields(primary) });
      try {
        saveMetadata(primary.repo_root, meta);
      } catch {
        // Non-fatal: the next listing rewrites it from memory.
      }
    }
  }
  emitHostEvent("session:updated", {
    id: primary.id,
    repo_root: primary.repo_root,
    linked_repos: primary.linked_repos ?? [],
  });
}

/** A linked repo's session went away on its own: drop it from its primary. */
export function unlinkFromPrimary(member: Session): void {
  const primary = member.cross_project_of
    ? appState.sessions.get(member.cross_project_of)
    : undefined;
  if (!primary?.linked_repos) {
    return;
  }
  setLinkedRepos(
    primary,
    primary.linked_repos.filter((r) => r.session_id !== member.id),
  );
}

/** Whether the worktree at `worktreePath` is one repository of a cross-project session. */
export function isCrossProjectPath(worktreePath: string): boolean {
  for (const s of appState.sessions.values()) {
    if (s.path === worktreePath) {
      return isCrossProject(s);
    }
  }

  return false;
}
