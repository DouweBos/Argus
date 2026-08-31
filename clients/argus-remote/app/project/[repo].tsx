import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Icons from "../../src/components/Icons";
import {
  AgentRow,
  SessionCard,
  StoppedAgentRow,
  agentMetaLabel,
  mapAgentStatus,
} from "../../src/components/rows";
import {
  Btn,
  EmptyState,
  Loading,
  Muted,
  Row,
  Screen,
  SectionHeader,
  TextField,
} from "../../src/components/ui";
import { useLiveRefresh } from "../../src/hooks/useLiveRefresh";
import type { RemoteAgentStatus, RemoteSession } from "../../src/lib/protocol";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

export default function ProjectScreen() {
  const theme = useTheme();
  const { repo, name } = useLocalSearchParams<{ repo: string; name?: string }>();
  const repoRoot = repo ?? "";
  const router = useRouter();

  const connection = useAppStore((s) => s.connection);
  const agents = useAppStore((s) => s.agentsByRepo[repoRoot]);
  const sessions = useAppStore((s) => s.sessionsByRepo[repoRoot]);
  const loadAgents = useAppStore((s) => s.loadAgents);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const loadRecentAgents = useAppStore((s) => s.loadRecentAgents);
  const hasControl = useAppStore((s) => s.hasControl());
  const spawnAgent = useAppStore((s) => s.spawnAgent);

  const refresh = useCallback(() => {
    loadAgents(repoRoot).catch(() => {});
    loadSessions(repoRoot).catch(() => {});
    loadRecentAgents().catch(() => {});
  }, [loadAgents, loadSessions, loadRecentAgents, repoRoot]);
  useLiveRefresh(connection === "ready", refresh);

  const openAgent = useCallback(
    (agentId: string, label: string) => {
      router.push({ pathname: "/agent/[id]", params: { id: agentId, label } });
    },
    [router],
  );

  const spawn = useCallback(
    (sessionId: string) => {
      spawnAgent(sessionId)
        .then((a) =>
          openAgent(a.agent_id, a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`),
        )
        .catch(() => {});
    },
    [spawnAgent, openAgent],
  );

  if (agents === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: name ?? "Project" }} />
        <Loading label="Loading agents…" />
      </Screen>
    );
  }

  // Group by session id (stable), carrying a label + its agents.
  const groups = new Map<string, { agents: RemoteAgentStatus[]; label: string }>();
  for (const a of agents) {
    const g = groups.get(a.session_id) ?? {
      label: a.session_label ?? "Session",
      agents: [],
    };
    g.agents.push(a);
    groups.set(a.session_id, g);
  }
  for (const s of sessions ?? []) {
    if (!groups.has(s.id)) {
      groups.set(s.id, { label: s.display_name ?? s.branch, agents: [] });
    }
  }
  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]));
  // Match the desktop sidebar: project_root sessions first, others keep order.
  const entries = [...groups.entries()].sort(([aId], [bId]) => {
    const aRoot = sessionById.get(aId)?.kind === "project_root";
    const bRoot = sessionById.get(bId)?.kind === "project_root";
    if (aRoot && !bRoot) {
      return -1;
    }

    return !aRoot && bRoot ? 1 : 0;
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: name ?? repoRoot.split("/").pop() ?? "Project" }} />

      {hasControl && <NewSessionForm repoRoot={repoRoot} onCreated={refresh} />}

      {entries.length === 0 && (
        <EmptyState
          icon={<Icons.Agent size={22} color={theme.textMuted} />}
          title="No agents running"
          body={
            hasControl
              ? "Create a session above, then start an agent in it — or start one in Argus on your computer."
              : "Start an agent in this project from Argus on your computer and it'll appear here. Ask the desktop to grant this device control to start agents remotely."
          }
        />
      )}

      {entries.map(([sessionId, group]) => (
        <SessionGroup
          key={sessionId}
          sessionId={sessionId}
          label={group.label}
          session={sessionById.get(sessionId)}
          agents={group.agents}
          repoRoot={repoRoot}
          hasControl={hasControl}
          onOpenAgent={openAgent}
          onSpawn={spawn}
          onChanged={refresh}
        />
      ))}

      <StoppedAgents repoRoot={repoRoot} />
    </Screen>
  );
}

/**
 * Agents that have already finished, read back from the computer's saved chat
 * history. Collapsed by default — this is a look-back, not the live picture.
 */
function StoppedAgents({ repoRoot }: { repoRoot: string }) {
  const theme = useTheme();
  const router = useRouter();
  const connection = useAppStore((s) => s.connection);
  const stopped = useAppStore((s) => s.stoppedByRepo[repoRoot]);
  const loadStoppedAgents = useAppStore((s) => s.loadStoppedAgents);
  const [open, setOpen] = useState(false);

  // Fetched on mount (for the count) and whenever the section is opened, not
  // on the list poll — it reads the project's history index off disk.
  useEffect(() => {
    if (connection === "ready") {
      loadStoppedAgents(repoRoot).catch(() => {});
    }
  }, [connection, loadStoppedAgents, repoRoot, open]);

  if (!stopped || stopped.length === 0) {
    return null;
  }

  return (
    <>
      <Btn
        label={
          open
            ? "Hide stopped agents"
            : `Show ${stopped.length} recently stopped agent${stopped.length === 1 ? "" : "s"}`
        }
        tone="ghost"
        size="sm"
        icon={<Icons.History size={12} color={theme.textSecondary} />}
        onPress={() => setOpen((v) => !v)}
      />

      {open && (
        <>
          <SectionHeader count={stopped.length}>Recently stopped</SectionHeader>
          {stopped.map((a) => (
            <StoppedAgentRow
              key={a.history_id}
              title={a.title}
              branch={a.branch}
              endedAt={a.ended_at}
              messageCount={a.message_count}
              onPress={() =>
                router.push({
                  pathname: "/stopped/[history]",
                  params: {
                    history: a.history_id,
                    repo: repoRoot,
                    label: a.title,
                    branch: a.branch,
                    runner: a.runner_session_id,
                  },
                })
              }
            />
          ))}
        </>
      )}
    </>
  );
}

/** One session's card: git badges, its agents, and (with control) spawn/rename/delete. */
function SessionGroup({
  sessionId,
  label,
  session,
  agents,
  repoRoot,
  hasControl,
  onOpenAgent,
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
  onSpawn: (sessionId: string) => void;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const git = useAppStore((s) => s.gitStatusBySession[sessionId]);
  const loadGitStatus = useAppStore((s) => s.loadGitStatus);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const renameSession = useAppStore((s) => s.renameSession);
  const renameSessionBranch = useAppStore((s) => s.renameSessionBranch);
  const [renaming, setRenaming] = useState<"branch" | "name" | null>(null);
  const [value, setValue] = useState("");
  // Only the project root can manage branches — session worktrees are pinned
  // to theirs, and the computer rejects branch ops on them.
  const canManageBranches = hasControl && session?.kind === "project_root";

  useEffect(() => {
    loadGitStatus(sessionId).catch(() => {});
  }, [sessionId, loadGitStatus]);

  const openBranches = useCallback(() => {
    router.push({
      pathname: "/branches/[session]",
      params: { session: sessionId, repo: repoRoot, label },
    });
  }, [router, sessionId, repoRoot, label]);

  const openChanges = useCallback(() => {
    router.push({
      pathname: "/changes/[session]",
      params: { session: sessionId, label },
    });
  }, [router, sessionId, label]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      `Delete “${label}”?`,
      "This stops its agents and removes the worktree.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete session",
          style: "destructive",
          onPress: () => deleteSession(sessionId, repoRoot).catch(() => {}),
        },
        {
          text: "Delete session + branch",
          style: "destructive",
          onPress: () => deleteSession(sessionId, repoRoot, true).catch(() => {}),
        },
      ],
    );
  }, [deleteSession, label, repoRoot, sessionId]);

  const showActions = useCallback(() => {
    Alert.alert(label, undefined, [
      { text: "View changes", onPress: openChanges },
      ...(canManageBranches
        ? [{ text: "Branches", onPress: openBranches }]
        : []),
      ...(hasControl
        ? [
            {
              text: "Rename",
              onPress: () => {
                setValue(label);
                setRenaming("name");
              },
            },
            {
              text: "Rename branch",
              onPress: () => {
                setValue(session?.branch ?? "");
                setRenaming("branch");
              },
            },
            {
              text: "Delete session",
              style: "destructive" as const,
              onPress: confirmDelete,
            },
          ]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [
    canManageBranches,
    confirmDelete,
    hasControl,
    label,
    openBranches,
    openChanges,
    session,
  ]);

  const submitRename = useCallback(() => {
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
  }, [onChanged, renameSession, renameSessionBranch, renaming, repoRoot, sessionId, value]);

  return (
    <SessionCard
      title={label}
      branch={session?.branch}
      kind={session?.kind}
      status={session?.status}
      additions={git?.diff_additions}
      deletions={git?.diff_deletions}
      divergence={
        git ? { ahead: git.ahead, behind: git.behind, dirty: git.dirty_count } : undefined
      }
      onActions={showActions}
    >
      {renaming && (
        <View style={{ gap: 8 }}>
          <TextField
            autoFocus
            value={value}
            onChangeText={setValue}
            placeholder={renaming === "branch" ? "new-branch-name" : "Session name"}
            onSubmitEditing={submitRename}
          />
          <Row>
            <Btn label="Save" size="sm" onPress={submitRename} />
            <Btn
              label="Cancel"
              size="sm"
              tone="ghost"
              onPress={() => setRenaming(null)}
            />
          </Row>
        </View>
      )}

      {agents.map((a) => {
        const agentName = a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`;

        return (
          <AgentRow
            key={a.agent_id}
            name={agentName}
            status={mapAgentStatus(a.status)}
            model={a.model ?? undefined}
            meta={agentMetaLabel(a.status)}
            onPress={() => onOpenAgent(a.agent_id, agentName)}
          />
        );
      })}

      <Row gap={8}>
        <Btn
          label="Changes"
          size="sm"
          tone="ghost"
          icon={<Icons.Branch size={12} color={theme.textSecondary} />}
          onPress={openChanges}
        />
        {canManageBranches && (
          <Btn
            label="Branches"
            size="sm"
            tone="ghost"
            icon={<Icons.Branch size={12} color={theme.textSecondary} />}
            onPress={openBranches}
          />
        )}
        {hasControl && (
          <Btn
            label="New agent"
            size="sm"
            tone="secondary"
            icon={<Icons.Plus size={12} color={theme.text} />}
            onPress={() => onSpawn(sessionId)}
          />
        )}
      </Row>
    </SessionCard>
  );
}

/** Inline "create a new session in this project" form (control devices only). */
function NewSessionForm({
  repoRoot,
  onCreated,
}: {
  repoRoot: string;
  onCreated: () => void;
}) {
  const createSession = useAppStore((s) => s.createSession);
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
      <Btn label="New session" tone="secondary" onPress={() => setOpen(true)} />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <TextField
        autoFocus
        value={description}
        onChangeText={setDescription}
        placeholder="What should this session do?"
        onSubmitEditing={submit}
      />
      <Row>
        <Btn
          label="Create"
          size="sm"
          disabled={busy || !description.trim()}
          onPress={submit}
        />
        <Btn label="Cancel" size="sm" tone="ghost" onPress={() => setOpen(false)} />
      </Row>
      {busy && <Muted>Creating session…</Muted>}
    </View>
  );
}
