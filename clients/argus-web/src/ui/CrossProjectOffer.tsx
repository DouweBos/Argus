/**
 * Above the composer once a message links another project: offers to give
 * the session a worktree of it on the same branch, so the agent changes both
 * and each repository lands on its own.
 */

import { useState } from "react";
import { Banner, Button } from "@argus/peacock";
import { useConnectionStore } from "../stores/connection";
import { makeCrossProject } from "../stores/crossProject";
import { useProjectsStore } from "../stores/projects";

function listNames(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function CrossProjectOffer({
  sessionId,
  linked,
}: {
  sessionId: string | undefined;
  linked: string[];
}) {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const projects = useProjectsStore((s) => s.projects);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const [declined, setDeclined] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const session = sessionId
    ? Object.values(sessionsByRepo)
        .flat()
        .find((s) => s.id === sessionId)
    : undefined;
  if (
    !hasControl ||
    !session ||
    session.kind !== "worktree" ||
    session.cross_project_of ||
    session.status !== "ready"
  ) {
    return null;
  }
  const spanned = new Set([
    session.repo_root,
    ...(session.linked_repos ?? []).map((r) => r.repo_root),
  ]);
  const candidates = projects.filter(
    (p) =>
      linked.includes(p.repo_root) &&
      !spanned.has(p.repo_root) &&
      !declined.includes(p.repo_root),
  );
  const roots = candidates.map((p) => p.repo_root);

  const add = () => {
    setAdding(true);
    makeCrossProject(session.id, roots)
      .then((failed) => setErrors(failed.map((f) => f.error)))
      .catch((e: unknown) => {
        setErrors([e instanceof Error ? e.message : String(e)]);
        setDeclined((d) => [...d, ...roots]);
      })
      .finally(() => setAdding(false));
  };

  const names = listNames(candidates.map((p) => p.name));

  return (
    <>
      {candidates.length > 0 && (
        <Banner
          tone="info"
          trailing={
            adding ? undefined : (
              <Button size="sm" onClick={add}>
                {candidates.length === 1 ? "Add Worktree" : "Add Worktrees"}
              </Button>
            )
          }
          onDismiss={
            adding ? undefined : () => setDeclined((d) => [...d, ...roots])
          }
        >
          <strong>Make this a cross-project session?</strong>{" "}
          {adding
            ? `Making a worktree of ${names} on ${session.branch} and running its setup`
            : `${candidates.length === 1 ? "It gets" : "Each gets"} a worktree on ${session.branch} so the agent can change ${names} too, and lands on its own.`}
        </Banner>
      )}
      {errors.map((error) => (
        <Banner
          key={error}
          tone="error"
          onDismiss={() => setErrors((e) => e.filter((x) => x !== error))}
        >
          {error}
        </Banner>
      ))}
    </>
  );
}
