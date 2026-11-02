/**
 * Screens a URL can name before the data behind them is loaded: a project
 * known by its key, a session with no agent picked, and a device known only
 * by its key.
 */

import { useEffect, useState } from "react";
import { Spinner } from "@argus/peacock";
import { appNavigate } from "../routing/router";
import { openAgent } from "../routing/open";
import { useConnectionStore } from "../stores/connection";
import { useDevicesStore } from "../stores/devices";
import { useProjectsStore } from "../stores/projects";
import type { RemotePlatform } from "../lib/protocol";
import type { AgentRef } from "../routing/open";
import { HOME, projectKey } from "../routing/screens";
import { DeviceScreen } from "./DeviceScreen";
import { Project } from "./ProjectViews";

function Waiting({ label }: { label: string }) {
  return (
    <div className="aw-center">
      <Spinner />
      <span className="aw-muted">{label}</span>
    </div>
  );
}

/** `/projects/:projectKey`: the project, once the list says which it is. */
export function ProjectRoute({
  projectKey: key,
  onOpenAgent,
  onOpenChanges,
}: {
  projectKey: string;
  onOpenAgent: (agent: AgentRef) => void;
  onOpenChanges: (sessionId: string) => void;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const projects = useProjectsStore((s) => s.projects);
  const loaded = useProjectsStore((s) => s.projectsLoad.loaded);
  const refreshProjects = useProjectsStore((s) => s.refreshProjects);
  const project = projects.find((p) => projectKey(p.repo_root) === key);

  useEffect(() => {
    if (connection === "ready" && !loaded) {
      refreshProjects({ background: true }).catch(() => {});
    }
  }, [connection, loaded, refreshProjects]);

  useEffect(() => {
    // A project that isn't open on this computer any more: back to the list.
    if (loaded && !project) {
      appNavigate(HOME, { replace: true });
    }
  }, [loaded, project]);

  if (!project) {
    return <Waiting label="Finding the project…" />;
  }

  return (
    <Project
      repoRoot={project.repo_root}
      onOpenAgent={onOpenAgent}
      onOpenChanges={onOpenChanges}
    />
  );
}

/** `/sessions/:id/agents`: the session's newest agent, once the list has it. */
export function SessionRedirect({ sessionId }: { sessionId: string }) {
  const connection = useConnectionStore((s) => s.connection);
  const recentAgents = useProjectsStore((s) => s.recentAgents);
  const loadRecentAgents = useProjectsStore((s) => s.loadRecentAgents);
  const newest = recentAgents
    .filter((a) => a.session_id === sessionId)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];

  // Only a list fetched for this link may send it home; an older one may predate its agent.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (connection === "ready") {
      loadRecentAgents()
        .catch(() => {})
        .finally(() => setChecked(true));
    }
  }, [connection, loadRecentAgents]);

  useEffect(() => {
    if (newest) {
      openAgent(newest, { replace: true });
    } else if (checked) {
      // No agent yet: the session's home, where one can be started.
      appNavigate({ name: "sessionHome", sessionId }, { replace: true });
    }
  }, [checked, newest, sessionId]);

  return <Waiting label="Finding the session…" />;
}

/** `/devices/:platform/:deviceKey`: an unknown device opens the list instead. */
export function DeviceRoute({
  platform,
  deviceKey,
}: {
  platform: RemotePlatform;
  deviceKey: string;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const devices = useDevicesStore((s) => s.devices);
  const refreshDevices = useDevicesStore((s) => s.refreshDevices);
  const device = devices.find(
    (d) => d.id === deviceKey && d.platform === platform,
  );
  // Only a list fetched for this link may send it away; an older one may
  // predate the device booting.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (connection === "ready" && !device) {
      refreshDevices({ background: true })
        .catch(() => {})
        .finally(() => setChecked(true));
    }
  }, [connection, device, refreshDevices]);

  useEffect(() => {
    if (checked && !device) {
      appNavigate({ name: "devices" }, { replace: true });
    }
  }, [checked, device]);

  if (!device) {
    return <Waiting label="Finding the device…" />;
  }

  return (
    <DeviceScreen deviceId={device.id} platform={platform} isTv={device.is_tv} />
  );
}
