/**
 * The bar over the centre: history, where you are, the screen's own actions
 * and the panel toggles. A session's screens read "Project / Session / …",
 * everything else its title over a one-line summary, as on the Mac.
 */

import type { ReactNode } from "react";
import { sessionTitle } from "@argus/client-core";
import {
  AppBreadcrumb,
  AppToolbar,
  AppToolbarTitle,
  type BreadcrumbStep,
} from "@argus/peacock";
import { appNavigate, navigateBack } from "../../routing/router";
import {
  projectScreen,
  type Screen,
  sessionOfScreen,
} from "../../routing/screens";
import { useAutomationsStore } from "../../stores/automations";
import { useProjectsStore } from "../../stores/projects";
import { useInboxBadge } from "../automations/useInbox";
import { parentOf } from "../panes";
import { useScreenTitle } from "../screenTitle";
import { useSession } from "./SessionHeader";

/** What a session's tool screen is called after "Project / Session". */
function toolLabel(screen: Screen, title: string): string | null {
  switch (screen.name) {
    case "agent":
    case "file":
    case "fileDiff":
    case "branch":
    case "commit":
    case "compare":
    case "chat":
      return title;
    case "changes":
      return "Changes";
    case "files":
      return "Files";
    case "search":
      return "Search";
    case "terminals":
      return "Terminals";
    case "browser":
      return "Browser";
    case "branches":
      return "Branches";
    case "stashes":
      return "Stashes & Tags";
    default:
      return null;
  }
}

function SessionCrumbs({
  screen,
  sessionId,
  title,
}: {
  screen: Screen;
  sessionId: string;
  title: string;
}) {
  const session = useSession(sessionId);
  const project = useProjectsStore((s) =>
    session ? s.projects.find((p) => p.repo_root === session.repo_root) : undefined,
  );
  const root = useProjectsStore((s) =>
    session
      ? s.sessionsByRepo[session.repo_root]?.find((x) => x.kind === "project_root")
      : undefined,
  );
  const steps: BreadcrumbStep[] = [];
  if (session && project) {
    steps.push({
      label: project.name,
      project: { name: project.name, key: project.repo_root },
      tooltip: project.name,
      onClick: () =>
        appNavigate(
          root && root.id !== session.id
            ? { name: "session", sessionId: root.id }
            : projectScreen(project.repo_root),
        ),
    });
  }
  const name = session ? sessionTitle(session) : "Session";
  steps.push({
    label: name,
    tooltip: session ? `${name} — ${session.branch}` : name,
    onClick: () => appNavigate({ name: "session", sessionId }),
  });
  const tool = toolLabel(screen, title);
  if (tool && tool !== name) {
    steps.push({ label: tool });
  }

  return <AppBreadcrumb steps={steps} />;
}

/** Overview screens get a one-line summary under their name. */
function useSubtitle(screen: Screen): string | undefined {
  const waiting = useInboxBadge();
  const automations = useAutomationsStore((s) => s.automations.length);
  switch (screen.name) {
    case "inbox":
      return waiting > 0
        ? `${waiting} decision${waiting === 1 ? "" : "s"} waiting`
        : "No decisions waiting";
    case "automations":
      return automations > 0
        ? `${automations} automation${automations === 1 ? "" : "s"}`
        : undefined;
    default:
      return undefined;
  }
}

export function WebToolbar({
  leading,
  screen,
  trailing,
}: {
  leading?: ReactNode;
  screen: Screen;
  trailing?: ReactNode;
}) {
  const title = useScreenTitle(screen);
  const subtitle = useSubtitle(screen);
  const sessionId = sessionOfScreen(screen);

  return (
    <AppToolbar
      leading={leading}
      title={
        sessionId ? (
          <SessionCrumbs screen={screen} sessionId={sessionId} title={title} />
        ) : (
          <AppToolbarTitle
            subtitle={subtitle}
            title={screen.name === "projects" ? "Home" : title}
          />
        )
      }
      trailing={trailing}
      onBack={() => navigateBack(parentOf(screen))}
      onForward={() => window.history.forward()}
      canGoForward
    />
  );
}
