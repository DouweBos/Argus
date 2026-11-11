/**
 * The window's sidebar, as on Argus for Mac: search and new session on top,
 * the everyday screens, every project with its sessions, and the occasional
 * screens along the foot. Selection is read off the URL.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  sessionActivity,
  sessionTitle,
  shortAge,
} from "@argus/client-core";
import {
  AppSidebar,
  AppSidebarFooter,
  AppSidebarGroup,
  AppSidebarNavItem,
  AppSidebarProjectHeader,
  AppSidebarSessionRow,
  FlatIconButton,
  Icons,
  SidebarSearchField,
} from "@argus/peacock";
import type { RemoteProject, RemoteSession } from "../../lib/protocol";
import { appNavigate } from "../../routing/router";
import {
  projectKey,
  projectScreen,
  type Screen,
  sessionOfScreen,
} from "../../routing/screens";
import { useConnectionStore } from "../../stores/connection";
import { useGitStore } from "../../stores/git";
import { linearConnected, useIntegrationsStore } from "../../stores/integrations";
import { useUnseenNotifications } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { useInboxBadge } from "../automations/useInbox";
import { ConnectionBadge } from "../ConnectionBadge";
import { capture } from "../../telemetry/telemetry";
import { PUSHED_LIST_REFRESH_MS, useLiveRefresh } from "../useLiveRefresh";
import { useShellPrefs } from "./shellPrefs";

interface Destination {
  label: string;
  icon: ReactNode;
  to: Screen;
  isOn: (screen: Screen) => boolean;
}

const is =
  (...names: Screen["name"][]) =>
  (screen: Screen) =>
    names.includes(screen.name);

const PRIMARY: Destination[] = [
  {
    label: "Home",
    icon: <Icons.HomeIcon size={14} />,
    to: { name: "projects" },
    isOn: is("projects"),
  },
  {
    label: "Inbox",
    icon: <Icons.InboxIcon size={15} />,
    to: { name: "inbox" },
    isOn: is("inbox", "proposal"),
  },
  {
    label: "Devices",
    icon: <Icons.SimulatorIcon size={14} />,
    to: { name: "devices" },
    isOn: is("devices", "device"),
  },
  {
    label: "Automations",
    icon: <Icons.ClockIcon size={14} />,
    to: { name: "automations" },
    isOn: is(
      "automations",
      "automation",
      "automationRun",
      "quickRun",
      "quickRunDetail",
      "describe",
    ),
  },
];

const ISSUES: Destination = {
  label: "Issues",
  icon: <Icons.LinearIcon size={14} />,
  to: { name: "issues", scope: "assigned", query: null, issueRef: null },
  isOn: is("issues"),
};

function matches(text: string | null | undefined, query: string): boolean {
  return !!text && text.toLowerCase().includes(query);
}

function useProjectLists(ready: boolean, projects: RemoteProject[]) {
  const loadSessions = useProjectsStore((s) => s.loadSessions);
  const loadAgents = useProjectsStore((s) => s.loadAgents);
  const refreshProjects = useProjectsStore((s) => s.refreshProjects);
  const roots = projects.map((p) => p.repo_root).join("\n");
  const refresh = useCallback(() => {
    refreshProjects({ background: true }).catch(() => {});
    for (const root of roots ? roots.split("\n") : []) {
      loadSessions(root).catch(() => {});
      loadAgents(root).catch(() => {});
    }
  }, [loadAgents, loadSessions, refreshProjects, roots]);
  useLiveRefresh(ready, refresh, PUSHED_LIST_REFRESH_MS);
}

/** A project's root checkout: the header that opens it, with its branch and sync counts. */
function ProjectSection({
  go,
  project,
  query,
  screen,
}: {
  go: (to: Screen) => void;
  project: RemoteProject;
  query: string;
  screen: Screen;
}) {
  const sessions = useProjectsStore((s) => s.sessionsByRepo[project.repo_root]);
  const agents = useProjectsStore((s) => s.agentsByRepo[project.repo_root]);
  const collapsed = useShellPrefs((s) => s.collapsed.includes(project.repo_root));
  const toggleCollapsed = useShellPrefs((s) => s.toggleCollapsed);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const root = sessions?.find((s) => s.kind === "project_root");
  const git = useGitStore((s) => (root ? s.gitStatusBySession[root.id] : undefined));
  const loadGitStatus = useGitStore((s) => s.loadGitStatus);
  const ready = root?.status === "ready";
  useEffect(() => {
    if (root && ready) {
      loadGitStatus(root.id).catch(() => {});
    }
  }, [loadGitStatus, ready, root]);

  const current = sessionOfScreen(screen);
  const agentsIn = (session: RemoteSession) =>
    (agents ?? []).filter((a) => a.session_id === session.id);
  const worktrees = (sessions ?? []).filter(
    (s) => s.kind === "worktree" || s.kind === "automation_host",
  );
  const searching = query.length > 0;
  const projectHit = matches(project.name, query);
  const shown = searching
    ? worktrees.filter(
        (s) =>
          projectHit || matches(sessionTitle(s), query) || matches(s.branch, query),
      )
    : collapsed
      ? worktrees.filter((s) => s.id === current)
      : worktrees;
  if (searching && !projectHit && shown.length === 0) {
    return null;
  }
  const rootActivity = root ? sessionActivity(root, agentsIn(root)) : null;
  const projectOn =
    (root && current === root.id) ||
    (screen.name === "project" &&
      screen.projectKey === projectKey(project.repo_root));

  return (
    <AppSidebarGroup>
      <AppSidebarProjectHeader
        ahead={git?.upstream ? git.ahead : 0}
        behind={git?.upstream ? git.behind : 0}
        branch={git?.branch ?? root?.branch}
        busy={rootActivity?.busy}
        collapsed={worktrees.length > 0 ? collapsed : null}
        name={project.name}
        projectKey={project.repo_root}
        selected={projectOn}
        status={rootActivity?.showsDot ? rootActivity.tone : undefined}
        unavailable={root?.availability === "unavailable"}
        onClick={() =>
          go(
            root
              ? { name: "session", sessionId: root.id }
              : projectScreen(project.repo_root),
          )
        }
        onNewSession={
          hasControl ? () => go(projectScreen(project.repo_root)) : undefined
        }
        onToggleCollapsed={() => toggleCollapsed(project.repo_root)}
      />
      {shown.map((session) => {
        const activity = sessionActivity(session, agentsIn(session));

        return (
          <AppSidebarSessionRow
            key={session.id}
            age={
              activity.lastActive ? shortAge(activity.lastActive) : undefined
            }
            busy={activity.busy}
            note={
              session.status === "ready"
                ? undefined
                : (activity.statusText ?? undefined)
            }
            selected={current === session.id}
            status={activity.showsDot ? activity.tone : undefined}
            title={sessionTitle(session)}
            tooltip={[session.branch, activity.statusText]
              .filter(Boolean)
              .join(" · ")}
            unavailable={session.availability === "unavailable"}
            onClick={() => go({ name: "session", sessionId: session.id })}
          />
        );
      })}
    </AppSidebarGroup>
  );
}

export function WebSidebar({
  screen,
  onNavigate,
}: {
  screen: Screen;
  /** After a pick, e.g. to close the drawer on a narrow window. */
  onNavigate?: () => void;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const account = useConnectionStore((s) => s.identity?.account);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const projects = useProjectsStore((s) => s.projects);
  const waiting = useInboxBadge();
  const unseen = useUnseenNotifications();
  const showsIssues = useIntegrationsStore((s) => linearConnected(s.integrations));
  const refreshIntegrations = useIntegrationsStore((s) => s.refreshIntegrations);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  useProjectLists(connection === "ready", projects);
  useEffect(() => {
    if (connection === "ready") {
      refreshIntegrations({ background: true }).catch(() => {});
    }
  }, [connection, refreshIntegrations]);

  const go = useCallback(
    (to: Screen) => {
      appNavigate(to);
      onNavigate?.();
    },
    [onNavigate],
  );
  const destinations = useMemo(
    () => (showsIssues ? [...PRIMARY, ISSUES] : PRIMARY),
    [showsIssues],
  );

  const footerButton = (
    label: string,
    icon: ReactNode,
    to: Screen,
    on: boolean,
    badge?: number,
  ) => (
    <FlatIconButton
      badge={badge}
      icon={icon}
      label={label}
      selected={on}
      size="lg"
      onClick={() => go(to)}
    />
  );

  return (
        <AppSidebar
        footer={
          <AppSidebarFooter
            leading={
              <>
                {footerButton(
                  "Settings",
                  <Icons.GearIcon size={15} />,
                  { name: "settings" },
                  is("settings", "settingsPage")(screen),
                )}
                {footerButton(
                  "Pull Requests",
                  <Icons.PullRequestIcon size={15} />,
                  { name: "pullRequests" },
                  is("pullRequests", "pullRequest")(screen),
                )}
                {footerButton(
                  "Usage",
                  <Icons.GaugeIcon size={15} />,
                  { name: "usage", tab: "limits", range: "30d" },
                  is("usage", "usageModel", "usagePrices")(screen),
                )}
              </>
            }
            trailing={footerButton(
              unseen > 0 ? `Notifications — ${unseen} new` : "Notifications",
              <Icons.BellIcon size={15} />,
              { name: "notifications" },
              is("notifications")(screen),
              unseen,
            )}
          />
        }
        nav={destinations.map((d) => (
          <AppSidebarNavItem
            key={d.label}
            count={d.label === "Inbox" ? waiting : undefined}
            icon={d.icon}
            label={d.label}
            selected={d.isOn(screen)}
            onClick={() => go(d.to)}
          />
        ))}
        status={
          connection === "ready" ? undefined : <ConnectionBadge state={connection} />
        }
        top={
          <>
            {account && (
              <FlatIconButton
                icon={<Icons.ChevronLeftIcon size={13} />}
                label="Computers"
                onClick={account.leave}
              />
            )}
            <SidebarSearchField
              value={search}
              onChange={(next) => {
                if (!search.trim() && next.trim()) {
                  capture("web_sidebar_filtered");
                }
                setSearch(next);
              }}
            />
            {hasControl && (
              <FlatIconButton
                disabled={projects.length === 0}
                icon={<Icons.ComposeIcon size={14} />}
                label="New session"
                onClick={() => {
                  const first = projects[0];
                  if (first) {
                    go(projectScreen(first.repo_root));
                  }
                }}
              />
            )}
          </>
        }
      >
        {projects.length === 0 && connection === "ready" && (
          <p className="aw-sidebar-empty">No projects yet</p>
        )}
        {projects.map((project) => (
          <ProjectSection
            key={project.repo_root}
            go={go}
            project={project}
            query={query}
            screen={screen}
          />
        ))}
      </AppSidebar>
  );
}
