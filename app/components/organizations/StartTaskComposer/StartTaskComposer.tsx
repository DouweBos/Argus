import type { Organization } from "../../../lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput, Chip, Icons } from "@argus/peacock";
import { startOrgTask, useOrgTasks } from "../../../stores/orgTaskStore";
import { selectSession } from "../../../stores/sessionStore";
import styles from "./StartTaskComposer.module.css";

interface Props {
  org: Organization;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

/** Derive a short title from the first line / first ~60 chars of the prompt. */
function deriveTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0] ?? "";
  if (firstLine.length <= 60) {
    return firstLine;
  }

  return `${firstLine.slice(0, 57).trimEnd()}…`;
}

export function StartTaskComposer({ org }: Props) {
  const [prompt, setPrompt] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const m of org.members) {
      init[m.repo_root] = true;
    }

    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingTaskId = useRef<string | null>(null);
  const tasks = useOrgTasks();

  // After creating a task, the host session is spawned asynchronously in the
  // backend. When the task's `host_session_id` becomes available, navigate
  // directly to the host session so the user lands on the live chat view.
  useEffect(() => {
    const pending = pendingTaskId.current;
    if (!pending) {
      return;
    }
    const task = tasks.find((t) => t.id === pending);
    if (task?.host_session_id) {
      pendingTaskId.current = null;
      selectSession(task.host_session_id);
    }
  }, [tasks]);

  const selectedRoots = useMemo(
    () => org.members.map((m) => m.repo_root).filter((r) => included[r]),
    [org.members, included],
  );

  const toggleMember = (repoRoot: string) => {
    setIncluded((prev) => ({ ...prev, [repoRoot]: !prev[repoRoot] }));
  };

  const handleSubmit = async () => {
    setError(null);
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    if (selectedRoots.length === 0) {
      setError("Select at least one repo.");

      return;
    }

    setSaving(true);
    try {
      const task = await startOrgTask({
        organizationId: org.id,
        title: deriveTitle(trimmed) || "Untitled task",
        prompt: trimmed,
        scope: selectedRoots.map((repo_root) => ({ repo_root })),
      });
      if (task.host_session_id) {
        selectSession(task.host_session_id);
      } else {
        pendingTaskId.current = task.id;
      }
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (org.members.length === 0) {
    return (
      <div className={styles.emptyMembers}>
        Add member repos to this organization before starting a task.
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.members}>
        {org.members.map((m) => {
          const on = !!included[m.repo_root];

          return (
            <Chip
              key={m.repo_root}
              mono
              muted={!on}
              interactive
              onClick={() => toggleMember(m.repo_root)}
              leading={
                on ? (
                  <Icons.CheckIcon size={10} />
                ) : (
                  <Icons.PlusIcon size={10} />
                )
              }
              title={m.repo_root}
            >
              {basename(m.repo_root)}
            </Chip>
          );
        })}
      </div>

      <ChatInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={handleSubmit}
        disabled={saving}
        placeholder="Describe the feature and expected end-state across the product…"
      />

      <div className={styles.meta}>
        {saving
          ? "Starting…"
          : `${selectedRoots.length} of ${org.members.length} repo${
              org.members.length === 1 ? "" : "s"
            } in scope · 1 agent in a neutral session`}
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
