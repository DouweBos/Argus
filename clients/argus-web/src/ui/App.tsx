import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentRow,
  type AgentStatus,
  Badge,
  Banner,
  Button,
  ContextMenu,
  type ContextMenuItem,
  EmptyState,
  Icons,
  Input,
  projectAccent,
  SessionCard,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarRepoGroup,
  SidebarSection,
  Spinner,
  StatusBulb,
} from "@argus/peacock";
import {
  notificationsSupported,
  requestNotificationPermission,
  setNotificationOpener,
} from "../lib/notify";
import { PairingClient, parsePairingInput } from "../lib/pairingClient";
import {
  setNotificationDecider,
  startServiceWorkerRouting,
} from "../lib/webpush";
import type { RemoteAgentStatus, RemoteSession } from "../lib/protocol";
import type { ConnectionState } from "../lib/transport";
import { useAppStore } from "../lib/store";
import { AgentTranscript } from "./AgentTranscript";
import { ChangesView } from "./ChangesView";
import { ChatInput } from "./ChatInput";
import { DevicesView } from "./DevicesView";
import { DeviceScreen } from "./DeviceScreen";
import { Settings } from "./Settings";
import { useHistoryView, type View } from "./useHistoryView";
import { useScrollRestore } from "./useScrollRestore";
import { useLiveRefresh } from "./useLiveRefresh";

export function App() {
  const identity = useAppStore((s) => s.identity);
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return identity ? <Monitor /> : <Pair />;
}

// --- Pairing ---------------------------------------------------------------

function Pair() {
  const pairComplete = useAppStore((s) => s.pairComplete);
  const [code, setCode] = useState("");
  const [sas, setSas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<PairingClient | null>(null);

  useEffect(() => () => clientRef.current?.cancel(), []);

  const begin = () => {
    setError(null);
    try {
      const payload = parsePairingInput(code);
      const client = new PairingClient(payload, {
        onSas: setSas,
        onPaired: (id) => pairComplete(id),
        onError: (m) => {
          setError(m);
          setSas(null);
        },
      });
      clientRef.current = client;
      client.start();
    } catch {
      setError("That doesn't look like a valid pairing code.");
    }
  };

  return (
    <div className="aw-shell">
      <header className="aw-hero">
        <Icons.ArgusLogo size={24} />
        <h1 className="aw-title">Argus Remote</h1>
      </header>
      <p className="aw-muted">
        In Argus: Settings → Remote Access → Start pairing, then paste the
        pairing code here.
      </p>

      {sas ? (
        <div className="aw-card">
          <p className="aw-muted">
            Confirm this matches the code in Argus, then tap “Codes match —
            pair” on your computer:
          </p>
          <div className="aw-sas">{sas}</div>
          <div className="aw-inline">
            <Spinner size="sm" />
            <span className="aw-muted">Waiting for confirmation…</span>
          </div>
        </div>
      ) : (
        <div className="aw-card">
          <textarea
            className="aw-textarea"
            placeholder="paste pairing code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div>
            <Button variant="primary" disabled={!code.trim()} onClick={begin}>
              Pair
            </Button>
          </div>
        </div>
      )}
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  );
}

// --- Monitor ---------------------------------------------------------------

/**
 * A healthy connection is the normal case and doesn't need saying, so it
 * shrinks to a dot — only trouble gets words.
 */
function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "ready") {
    return (
      <StatusBulb
        tone="success"
        size="sm"
        aria-label="Connected"
        className="aw-header-dot"
      />
    );
  }
  if (state === "offline") {
    return <Badge tone="warning">Reconnecting…</Badge>;
  }

  return (
    <span className="aw-inline">
      <Spinner size="xs" />
      <Badge tone="neutral">
        {state === "handshaking" ? "Securing" : "Connecting"}
      </Badge>
    </span>
  );
}

function Monitor() {
  const { view, push, back, canGoBack } = useHistoryView();
  const mainRef = useRef<HTMLDivElement>(null);
  const connection = useAppStore((s) => s.connection);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const hasControl = useAppStore((s) => s.hasControl());
  const stopAgentProcess = useAppStore((s) => s.stopAgentProcess);
  const devices = useAppStore((s) => s.devices);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const pushEnabled = useAppStore((s) => s.pushEnabled);
  const setPushEnabled = useAppStore((s) => s.setPushEnabled);
  const agentSessionId = useAppStore((s) =>
    view.name === "agent"
      ? s.statusByAgent[view.agentId]?.session_id
      : undefined,
  );

  // Fetched once, not polled: this only decides where the device button in an
  // agent's header goes.
  useEffect(() => {
    if (connection === "ready" && view.name === "agent") {
      void refreshDevices().catch(() => {});
    }
  }, [connection, refreshDevices, view.name]);

  // Let a notification click navigate to its agent — from this tab, or
  // forwarded by the service worker when a background push is tapped.
  useEffect(() => {
    setNotificationOpener((agentId, agentLabel) =>
      push({ name: "agent", agentId, agentLabel }),
    );
    setNotificationDecider((agentId, toolUseId, decision) => {
      void useAppStore.getState().decidePrompt(agentId, toolUseId, decision);
    });
    const stopRouting = startServiceWorkerRouting();

    return () => {
      setNotificationOpener(null);
      setNotificationDecider(null);
      stopRouting();
    };
  }, [push]);

  // Ask for notification permission once the channel is up (desktop/Android;
  // iOS Safari needs the Settings button, which provides a user gesture).
  // Permission gates the push subscription, so re-run registration after.
  useEffect(() => {
    if (
      connection === "ready" &&
      notificationsSupported() &&
      Notification.permission === "default"
    ) {
      void requestNotificationPermission().then(() =>
        setPushEnabled(pushEnabled),
      );
    }
  }, [connection, pushEnabled, setPushEnabled]);

  // A notification actioned with no tab open launches us at `?agent=…`, and an
  // Approve/Deny adds `?decide=…&tool=…`. Replay it, then drop the params so a
  // reload doesn't do it twice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agentId = params.get("agent");
    if (!agentId) {
      return;
    }
    const decision = params.get("decide");
    const toolUseId = params.get("tool");
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    if ((decision === "allow" || decision === "deny") && toolUseId) {
      void useAppStore.getState().decidePrompt(agentId, toolUseId, decision);

      return;
    }
    push({ name: "agent", agentId, agentLabel: "Agent" });
  }, [push]);

  const heading =
    view.name === "projects"
      ? "Projects"
      : view.name === "project"
        ? view.projectName
        : view.name === "settings"
          ? "Settings"
          : view.name === "changes"
            ? `Changes · ${view.label}`
            : view.name === "devices"
              ? "Devices"
              : view.name === "device"
                ? view.deviceName
                : view.agentLabel;

  useScrollRestore(mainRef, viewKey(view), view.name !== "agent");

  return (
    <div className="aw-shell">
      <SidebarHeader
        className="aw-topbar"
        brand={
          <>
            {canGoBack ? (
              <SidebarHeaderAction
                onClick={back}
                title="Back"
                aria-label="Back"
              >
                <Icons.ChevronLeftIcon size={14} />
              </SidebarHeaderAction>
            ) : (
              <Icons.ArgusLogo size={16} />
            )}
            <span className="aw-topbar-title" title={heading}>
              {heading}
            </span>
          </>
        }
        actions={
          <>
            <ConnectionBadge state={connection} />
            {view.name === "agent" && (
              <>
                <SidebarHeaderAction
                  onClick={() => {
                    const only = devices.length === 1 ? devices[0] : null;
                    push(
                      only
                        ? {
                            name: "device",
                            deviceId: only.id,
                            platform: only.platform,
                            deviceName: only.name,
                            isTv: only.is_tv,
                          }
                        : { name: "devices" },
                    );
                  }}
                  title="Devices"
                  aria-label="Devices"
                >
                  <Icons.SimulatorIcon size={14} />
                </SidebarHeaderAction>
                {agentSessionId && (
                  <SidebarHeaderAction
                    onClick={() =>
                      push({
                        name: "changes",
                        sessionId: agentSessionId,
                        label: view.agentLabel,
                      })
                    }
                    title="View changes"
                    aria-label="View changes"
                  >
                    <Icons.BranchIcon size={14} />
                  </SidebarHeaderAction>
                )}
                {hasControl && (
                  <SidebarHeaderAction
                    onClick={() => {
                      // Stopping kills the agent and its queue — not something
                      // to do on a mis-click.
                      if (
                        !window.confirm(
                          "Stop this agent? It stops mid-turn and anything still queued for it is discarded.",
                        )
                      ) {
                        return;
                      }
                      stopAgentProcess(view.agentId)
                        .then(back)
                        .catch(() => {});
                    }}
                    title="Stop agent"
                    aria-label="Stop agent"
                  >
                    <Icons.StopIcon size={14} />
                  </SidebarHeaderAction>
                )}
              </>
            )}
            {!canGoBack && (
              <>
                <SidebarHeaderAction
                  onClick={() => push({ name: "devices" })}
                  title="Devices"
                  aria-label="Devices"
                >
                  <Icons.SimulatorIcon size={14} />
                </SidebarHeaderAction>
                <SidebarHeaderAction
                  onClick={() => refreshProjects().catch(() => {})}
                  title="Refresh"
                  aria-label="Refresh"
                  disabled={connection !== "ready"}
                >
                  <Icons.RefreshIcon size={14} />
                </SidebarHeaderAction>
                <SidebarHeaderAction
                  onClick={() => push({ name: "settings" })}
                  title="Settings"
                  aria-label="Settings"
                >
                  <Icons.GearIcon size={14} />
                </SidebarHeaderAction>
              </>
            )}
          </>
        }
      />

      <div className="aw-main" ref={mainRef}>
        {connection === "offline" && (
          <Banner tone="warning">
            Lost the connection to Argus — retrying automatically.
          </Banner>
        )}

        {view.name === "projects" && (
          <Projects
            onOpen={(repoRoot, projectName) =>
              push({ name: "project", repoRoot, projectName })
            }
            onOpenAgent={(agentId, agentLabel) =>
              push({ name: "agent", agentId, agentLabel })
            }
          />
        )}
        {view.name === "project" && (
          <Project
            repoRoot={view.repoRoot}
            onOpenAgent={(agentId, agentLabel) =>
              push({ name: "agent", agentId, agentLabel })
            }
            onOpenChanges={(sessionId, label) =>
              push({ name: "changes", sessionId, label })
            }
          />
        )}
        {view.name === "agent" && <AgentTranscript agentId={view.agentId} />}
        {view.name === "changes" && <ChangesView sessionId={view.sessionId} />}
        {view.name === "devices" && (
          <DevicesView
            onOpen={(d) =>
              push({
                name: "device",
                deviceId: d.id,
                platform: d.platform,
                deviceName: d.name,
                isTv: d.is_tv,
              })
            }
          />
        )}
        {view.name === "device" && (
          <DeviceScreen
            deviceId={view.deviceId}
            platform={view.platform}
            isTv={view.isTv}
          />
        )}
        {view.name === "settings" && <Settings />}
      </div>

      {view.name === "agent" && <AgentDock agentId={view.agentId} />}
    </div>
  );
}

/** Identity of the view for scroll memory — same screen, same key. */
function viewKey(view: View): string {
  switch (view.name) {
    case "project":
      return `project:${view.repoRoot}`;
    case "agent":
      return `agent:${view.agentId}`;
    case "changes":
      return `changes:${view.sessionId}`;
    case "device":
      return `device:${view.deviceId}`;
    default:
      return view.name;
  }
}

/** The control-only chat input, pinned below the transcript scroll area. */
function AgentDock({ agentId }: { agentId: string }) {
  const hasControl = useAppStore((s) => s.hasControl());
  const sessionId = useAppStore((s) => s.statusByAgent[agentId]?.session_id);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);

  useEffect(() => {
    if (!sessionId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [agentId, sessionId, loadAgentStatus]);

  if (!hasControl) {
    return null;
  }

  return (
    <div className="aw-chat-dock">
      <ChatInput agentId={agentId} sessionId={sessionId} />
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="aw-center">
      <Spinner />
      <span className="aw-muted">{label}</span>
    </div>
  );
}

function toTildePath(absPath: string): string {
  const match = absPath.match(/^(\/(?:Users|home)\/[^/]+)/);

  return match ? absPath.replace(match[1], "~") : absPath;
}

function mapAgentStatus(status: string): AgentStatus {
  switch (status) {
    case "running":
      return "running";
    case "requires_action":
      return "pending";
    case "error":
      return "error";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

function agentMetaLabel(status: string): string {
  switch (status) {
    case "running":
      return "running";
    case "requires_action":
      return "needs input";
    case "error":
      return "blocked";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

/** Most-recently-active agents across all projects — a quick jump back to what
 *  you're driving. Shown on Home and inside a project's session view. */
function RecentAgents({
  onOpenAgent,
}: {
  onOpenAgent: (agentId: string, label: string) => void;
}) {
  const recentAgents = useAppStore((s) => s.recentAgents);
  const recent = [...recentAgents]
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, 8);

  if (recent.length === 0) {
    return null;
  }

  return (
    <div className="aw-group">
      <SidebarSection count={recent.length}>Recent agents</SidebarSection>
      {recent.map((a) => {
        const name = a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`;

        return (
          <AgentRow
            key={a.agent_id}
            name={name}
            status={mapAgentStatus(a.status)}
            meta={a.session_label ?? agentMetaLabel(a.status)}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => onOpenAgent(a.agent_id, name)}
          />
        );
      })}
    </div>
  );
}

function Projects({
  onOpen,
  onOpenAgent,
}: {
  onOpen: (repoRoot: string, name: string) => void;
  onOpenAgent: (agentId: string, label: string) => void;
}) {
  const connection = useAppStore((s) => s.connection);
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const loadRecentAgents = useAppStore((s) => s.loadRecentAgents);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    refreshProjects()
      .catch(() => {})
      .finally(() => setLoaded(true));
    loadRecentAgents().catch(() => {});
  }, [refreshProjects, loadRecentAgents]);
  useLiveRefresh(connection === "ready", refresh);

  if (connection !== "ready" && !loaded) {
    return <Loading label="Connecting to Argus…" />;
  }
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<Icons.FolderIcon size={22} />}
        title="No projects open"
        body="Open a repository in Argus on your computer and it'll show up here."
      />
    );
  }

  return (
    <div className="aw-sidebar">
      <RecentAgents onOpenAgent={onOpenAgent} />
      <SidebarSection count={projects.length}>Projects</SidebarSection>
      {projects.map((p) => (
        <SidebarRepoGroup
          key={p.repo_root}
          name={p.name}
          title={p.repo_root}
          color={projectAccent(p.repo_root)}
          hideChevron
          leading={<Icons.FolderIcon size={11} />}
          subtitle={
            <span className="aw-truncate">{toTildePath(p.repo_root)}</span>
          }
          endContent={<Icons.ChevronRightIcon size={13} />}
          onHeaderClick={() => onOpen(p.repo_root, p.name)}
        />
      ))}
    </div>
  );
}

function Project({
  repoRoot,
  onOpenAgent,
  onOpenChanges,
}: {
  repoRoot: string;
  onOpenAgent: (agentId: string, label: string) => void;
  onOpenChanges: (sessionId: string, label: string) => void;
}) {
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

  const spawn = useCallback(
    (sessionId: string) => {
      spawnAgent(sessionId)
        .then((a) =>
          onOpenAgent(
            a.agent_id,
            a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`,
          ),
        )
        .catch(() => {});
    },
    [spawnAgent, onOpenAgent],
  );

  if (agents === undefined) {
    return <Loading label="Loading agents…" />;
  }

  // Group by session id (stable), carrying a label + its agents.
  const groups = new Map<
    string,
    { agents: RemoteAgentStatus[]; label: string }
  >();
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
    if (aRoot && !bRoot) return -1;
    if (!aRoot && bRoot) return 1;
    return 0;
  });

  return (
    <div className="aw-sidebar">
      {hasControl && (
        <div className="aw-control-bar">
          <NewSessionForm repoRoot={repoRoot} onCreated={refresh} />
        </div>
      )}

      {entries.length === 0 && (
        <EmptyState
          icon={<Icons.AgentIcon size={22} />}
          title="No agents running"
          body={
            hasControl
              ? "Create a session with “New session” above, then start an agent in it — or start one in Argus on your computer."
              : "Start an agent in this project from Argus on your computer and it'll appear here. This device can monitor and approve prompts; ask the desktop to grant it control to start agents and sessions remotely."
          }
        />
      )}

      {entries.map(([sessionId, g]) => (
        <SessionGroup
          key={sessionId}
          sessionId={sessionId}
          label={g.label}
          session={sessionById.get(sessionId)}
          agents={g.agents}
          repoRoot={repoRoot}
          hasControl={hasControl}
          onOpenAgent={onOpenAgent}
          onOpenChanges={onOpenChanges}
          onSpawn={spawn}
          onChanged={refresh}
        />
      ))}

      <RecentAgents onOpenAgent={onOpenAgent} />
    </div>
  );
}

/** One session's row group: header (label + git badge + actions menu), its
 *  agents, and (for control devices) a spawn button + rename/delete actions. */
function SessionGroup({
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
  const git = useAppStore((s) => s.gitStatusBySession[sessionId]);
  const loadGitStatus = useAppStore((s) => s.loadGitStatus);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const renameSession = useAppStore((s) => s.renameSession);
  const renameSessionBranch = useAppStore((s) => s.renameSessionBranch);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<"branch" | "name" | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    loadGitStatus(sessionId).catch(() => {});
  }, [sessionId, loadGitStatus]);

  const doDelete = () => {
    if (
      !window.confirm(
        `Delete session “${label}”? This stops its agents and removes the worktree.`,
      )
    ) {
      return;
    }
    const alsoBranch = window.confirm("Also delete the git branch?");
    deleteSession(sessionId, repoRoot, alsoBranch).catch(() => {});
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
      className="aw-session-card"
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
            status={mapAgentStatus(a.status)}
            model={a.model ?? undefined}
            meta={agentMetaLabel(a.status)}
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
