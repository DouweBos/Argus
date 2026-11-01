/**
 * A session's card — its git state, its agents and the actions on it — plus the
 * inline form that creates a new one.
 */

import { useEffect, useState } from "react";
import {
  AgentRow,
  Button,
  ConfirmDialog,
  ContextMenu,
  type ContextMenuItem,
  Icons,
  Input,
  SessionCard,
  Toggle,
} from "@argus/peacock";
import type { RemoteAgentStatus, RemoteSession } from "../lib/protocol";
import { useGitStore } from "../stores/git";
import { useProjectsStore } from "../stores/projects";
import {
  agentAwaitingLabel,
  agentMetaLabel,
  mapAgentStatus,
} from "./agentStatus";

/** One session's row group: header (label + git badge + actions menu), its
 *  agents, and (for control devices) a spawn button + rename/delete actions. */
export function SessionGroup({
  sessionId,
  label,
  session,
  agents,
  repoRoot,
  hasControl,
  onOpenAgent,
  onOpenChanges,
  onSpawn,
  onChanged,
}: {
  sessionId: string;
  label: string;
  session?: RemoteSession;
  agents: RemoteAgentStatus[];
  repoRoot: string;
  hasControl: boolean;
  onOpenAgent: (agentId: string, label: string) => void;
  onOpenChanges: (sessionId: string, label: string) => void;
  onSpawn: (sessionId: string) => void;
  onChanged: () => void;
}) {
  const git = useGitStore((s) => s.gitStatusBySession[sessionId]);
  const loadGitStatus = useGitStore((s) => s.loadGitStatus);
  const deleteSession = useProjectsStore((s) => s.deleteSession);
  const renameSession = useProjectsStore((s) => s.renameSession);
  const renameSessionBranch = useProjectsStore((s) => s.renameSessionBranch);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<"branch" | "name" | null>(null);
  const [value, setValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);

  useEffect(() => {
    loadGitStatus(sessionId).catch(() => {});
  }, [sessionId, loadGitStatus]);

  const doDelete = () => {
    setDeleteBranch(false);
    setConfirmingDelete(true);
  };

  const submitRename = () => {
    const v = value.trim();
    if (!v) {
      setRenaming(null);

      return;
    }
    const p =
      renaming === "branch"
        ? renameSessionBranch(sessionId, repoRoot, v)
        : renameSession(sessionId, repoRoot, v);
    p.catch(() => {}).finally(() => {
      setRenaming(null);
      onChanged();
    });
  };

  const items: ContextMenuItem[] = [
    { label: "View changes", onClick: () => onOpenChanges(sessionId, label) },
    ...(hasControl
      ? [
          { separator: true } as ContextMenuItem,
          {
            label: "Rename",
            onClick: () => {
              setValue(label);
              setRenaming("name");
            },
          },
          {
            label: "Rename branch",
            onClick: () => {
              setValue("");
              setRenaming("branch");
            },
          },
          { label: "Delete session", danger: true, onClick: doDelete },
        ]
      : []),
  ];

  const additions = git?.diff_additions ?? 0;
  const deletions = git?.diff_deletions ?? 0;

  const kind = session?.kind;
  const isRoot = kind === "project_root";
  const branch = session?.branch;
  const showBranch = branch && branch !== label;
  const status = session?.status;
  const showStatus = Boolean(status) && status !== "ready";

  return (
    <SessionCard
      framed
      icon={
        isRoot ? <Icons.RepoIcon size={13} /> : <Icons.BranchIcon size={13} />
      }
      title={label}
      actionReveal="always"
      kind={
        isRoot
          ? { label: "root", tone: "accent" }
          : kind === "worktree"
            ? { label: "worktree", tone: "neutralFilled" }
            : undefined
      }
      status={showStatus ? { label: status!, tone: "neutral" } : undefined}
      diff={
        additions > 0 || deletions > 0
          ? {
              added: additions > 0 ? additions : undefined,
              removed: deletions > 0 ? deletions : undefined,
            }
          : undefined
      }
      divergence={
        git
          ? { ahead: git.ahead, behind: git.behind, dirty: git.dirty_count }
          : undefined
      }
      subtitle={
        showBranch ? (
          <span className="aw-session-branch">{branch}</span>
        ) : undefined
      }
      actions={
        <Button
          variant="ghost"
          aria-label="Session actions"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom + 4 });
          }}
        >
          <Icons.EllipsisIcon size={14} />
        </Button>
      }
    >
      {renaming && (
        <div className="aw-new-session">
          <Input
            autoFocus
            placeholder={
              renaming === "branch" ? "new-branch-name" : "Session name"
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submitRename();
              }
              if (e.key === "Escape") {
                setRenaming(null);
              }
            }}
          />
          <div className="aw-inline">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitRename}>
              Save
            </Button>
          </div>
        </div>
      )}

      {agents.map((a) => {
        const name = a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`;

        return (
          <AgentRow
            key={a.agent_id}
            name={name}
            status={a.awaiting ? "pending" : mapAgentStatus(a.status)}
            model={a.model ?? undefined}
            meta={agentAwaitingLabel(a) ?? agentMetaLabel(a.status)}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => onOpenAgent(a.agent_id, name)}
          />
        );
      })}

      {hasControl && (
        <button className="aw-new-agent" onClick={() => onSpawn(sessionId)}>
          <Icons.PlusIcon size={12} /> New agent in this session
        </button>
      )}

      {menu && (
        <ContextMenu
          items={items}
          position={menu}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          destructive
          confirmLabel="Delete session"
          title={`Delete “${label}”?`}
          titleId={`aw-delete-${sessionId}`}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() =>
            deleteSession(sessionId, repoRoot, deleteBranch)
              .catch(() => {})
              .finally(() => setConfirmingDelete(false))
          }
        >
          <p className="aw-muted">
            This stops its agents and removes the worktree.
          </p>
          <Toggle checked={deleteBranch} onChange={setDeleteBranch}>
            Also delete the git branch
          </Toggle>
        </ConfirmDialog>
      )}
    </SessionCard>
  );
}

/** Inline "create a new session in this project" form (control devices only). */
export function NewSessionForm({
  repoRoot,
  onCreated,
}: {
  repoRoot: string;
  onCreated: () => void;
}) {
  const createSession = useProjectsStore((s) => s.createSession);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const desc = description.trim();
    if (!desc || busy) {
      return;
    }
    setBusy(true);
    createSession({ repoRoot, branch: "", description: desc })
      .then(() => {
        setDescription("");
        setOpen(false);
        onCreated();
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Icons.PlusIcon size={12} /> New session
      </Button>
    );
  }

  return (
    <div className="aw-new-session">
      <Input
        autoFocus
        placeholder="What should this session do?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <div className="aw-inline">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !description.trim()}
          onClick={submit}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

