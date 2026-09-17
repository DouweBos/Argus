/**
 * macOS menu-bar tray.
 *
 * Adds a small status-bar item styled after the Argus app icon. Its tooltip
 * shows how many agents are running, and clicking it pops up a freshly built
 * dropdown of every live agent grouped by session — selecting one focuses the
 * main window and navigates to that session's screen.
 *
 * The icon swaps between two template PNGs (idle vs. active) so macOS keeps
 * tinting it for light/dark menu bars while we still surface "something is
 * happening" at a glance.
 */

import type { AgentSession } from "@argus/host/services/agent/models";
import type { Session } from "@argus/host/services/session/models";
import { Menu, Tray, app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { isServerMode } from "@argus/host/serverMode";
import { appState } from "@argus/host/state";
import {
  cancelServerPairing,
  confirmServerPairing,
  dismissServerPairing,
  getServerPairingState,
  setServerPairingListener,
  startServerPairing,
} from "../../serverPairing";

let tray: Tray | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastActive = false;

const isDev = !app.isPackaged;

interface TrayHooks {
  /**
   * Show + focus the main window and navigate to the given path.
   *
   * `agentId` is forwarded to the renderer so the deep-link can also set the
   * session's active agent — important when the user is already on the same
   * session and a plain navigate() would be a no-op.
   */
  navigateMainWindow: (path: string, agentId?: string) => void;
  /**
   * Extra read-only lines for the top of the menu. The headless server has no
   * window, so the tray is where its gateway URL and state directory live.
   */
  describeHost?: () => string[];
}

let hooks: TrayHooks | null = null;

function resolveIconPath(filename: string): string | null {
  const candidates = isDev
    ? [
        path.join(__dirname, "..", "build", "menu-icons", filename),
        path.join(__dirname, "..", "..", "build", "menu-icons", filename),
      ]
    : [
        path.join(process.resourcesPath, "menu-icons", filename),
        path.join(app.getAppPath(), "build", "menu-icons", filename),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function loadTrayImage(active: boolean): Electron.NativeImage {
  const base = active ? "argus-activeTemplate.png" : "argusTemplate.png";
  const onePath = resolveIconPath(base);
  if (!onePath) {
    return nativeImage.createEmpty();
  }
  const image = nativeImage.createFromPath(onePath);
  // The matching @2x next to it is picked up automatically by nativeImage
  // when the path follows the `*Template.png` / `*Template@2x.png` pair
  // convention, so no extra wiring is needed here.
  image.setTemplateImage(true);

  return image;
}

/**
 * Whether the agent is doing work right now. The CLI's `session_state_changed`
 * can flip to `idle` between tool calls within the same turn, so process
 * status alone understates activity — we also count any in-flight prompt that
 * hasn't emitted its final `result` event yet. This mirrors the renderer's
 * `inflight` tracking so the tray view agrees with the agents screen.
 */
function isAgentActive(a: AgentSession): boolean {
  if (a.prewarmed) {
    return false;
  }
  if (a.status === "stopped" || a.status === "error") {
    return false;
  }

  return (
    a.status === "running" ||
    a.status === "requires_action" ||
    a.inflightPrompts > 0
  );
}

/** Whether at least one agent is in a "doing work" state. */
function hasActiveAgents(): boolean {
  for (const a of appState.agents.values()) {
    if (isAgentActive(a)) {
      return true;
    }
  }

  return false;
}

function projectName(session: Session): string | null {
  const root = session.repo_root;
  if (!root) {
    return null;
  }
  const segments = root.split("/").filter(Boolean);

  return segments[segments.length - 1] ?? null;
}

function agentLabel(agentId: string): string {
  const snapshotJson = appState.agentSnapshots.get(agentId);
  if (snapshotJson) {
    try {
      const parsed = JSON.parse(snapshotJson) as { title?: string };
      const title = parsed.title?.trim();
      if (title) {
        return title;
      }
    } catch {
      // fall through
    }
  }

  return "Agent";
}

function navigateToSession(sessionId: string, agentId?: string): void {
  if (!hooks) {
    return;
  }
  hooks.navigateMainWindow(`/sessions/${sessionId}/agents`, agentId);
}

function projectKey(session: Session): string {
  return session.repo_root ?? "__no_project__";
}

function projectDisplayName(session: Session | undefined): string {
  if (!session) {
    return "Project";
  }
  const name = projectName(session);

  return name ?? "Project";
}

function shortSessionLabel(session: Session): string {
  return session.display_name?.trim() || session.branch || "Untitled session";
}

function buildMenu(): Menu {
  // Build Project → Sessions → Agents tree. Agents are the source of truth
  // for which sessions appear (we only surface sessions that have at least
  // one live agent), and sessions tell us which project bucket they fall in.
  const sessionAgents = new Map<string, AgentSession[]>();
  for (const agent of appState.agents.values()) {
    if (agent.prewarmed) {
      continue;
    }
    const list = sessionAgents.get(agent.sessionId) ?? [];
    list.push(agent);
    sessionAgents.set(agent.sessionId, list);
  }

  const projects = new Map<
    string,
    {
      session: Session | undefined;
      sessionId: string;
      agents: AgentSession[];
    }[]
  >();
  for (const [sessionId, agents] of sessionAgents) {
    const session = appState.sessions.get(sessionId);
    const key = session ? projectKey(session) : "__no_project__";
    const list = projects.get(key) ?? [];
    list.push({ session, sessionId, agents });
    projects.set(key, list);
  }

  const template: Electron.MenuItemConstructorOptions[] = [];
  const hostLines = hooks?.describeHost?.() ?? [];
  for (const line of hostLines) {
    template.push({ label: line, enabled: false });
  }
  if (hostLines.length > 0) {
    template.push({ type: "separator" });
  }
  let runningCount = 0;
  let totalAgentCount = 0;
  for (const agents of sessionAgents.values()) {
    for (const a of agents) {
      totalAgentCount += 1;
      if (isAgentActive(a)) {
        runningCount += 1;
      }
    }
  }

  template.push({
    label:
      sessionAgents.size === 0
        ? "No agents running"
        : `${totalAgentCount} agent${totalAgentCount === 1 ? "" : "s"} · ${runningCount} active`,
    enabled: false,
  });
  template.push({ type: "separator" });

  if (projects.size > 0) {
    // Sort projects by the most-recent agent activity within them.
    const projectEntries = Array.from(projects.entries()).sort(
      ([, a], [, b]) => {
        const aMax = Math.max(
          ...a.flatMap((s) => s.agents.map((x) => x.createdAt)),
        );
        const bMax = Math.max(
          ...b.flatMap((s) => s.agents.map((x) => x.createdAt)),
        );

        return bMax - aMax;
      },
    );

    for (const [, sessions] of projectEntries) {
      // Sessions newest-first by their newest agent.
      sessions.sort((a, b) => {
        const aMax = Math.max(...a.agents.map((x) => x.createdAt));
        const bMax = Math.max(...b.agents.map((x) => x.createdAt));

        return bMax - aMax;
      });

      const projectLabel = projectDisplayName(sessions[0]?.session);
      const totalAgents = sessions.reduce((n, s) => n + s.agents.length, 0);
      const projectRunning = sessions.some((s) => s.agents.some(isAgentActive));

      template.push({
        label: `${projectRunning ? "● " : "○ "}${projectLabel}  (${totalAgents})`,
        submenu: sessions.map<Electron.MenuItemConstructorOptions>(
          ({ session, sessionId, agents }) => {
            const label = session ? shortSessionLabel(session) : "Session";
            const sessionRunning = agents.some(isAgentActive);

            return {
              label: `${sessionRunning ? "● " : "○ "}${label}  (${agents.length})`,
              click: () => navigateToSession(sessionId),
              submenu: agents
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .map<Electron.MenuItemConstructorOptions>((agent) => ({
                  label: `${isAgentActive(agent) ? "● " : "○ "}${agentLabel(agent.agentId)}`,
                  click: () => navigateToSession(sessionId, agent.agentId),
                })),
            };
          },
        ),
      });
    }
  }

  template.push({ type: "separator" });
  if (isServerMode()) {
    for (const item of buildPairingItems()) {
      template.push(item);
    }
    template.push({ type: "separator" });
  } else {
    template.push({
      label: "Show Argus",
      click: () => hooks?.navigateMainWindow("/"),
    });
  }
  template.push({ role: "quit" });

  return Menu.buildFromTemplate(template);
}

/**
 * The server's pairing flow, rendered as menu items.
 *
 * The SAS is shown so a human can compare it against the client's screen — the
 * whole point of the confirmation — and the two grant choices are separate
 * items so admin is never what you get by clicking the obvious one.
 */
function buildPairingItems(): Electron.MenuItemConstructorOptions[] {
  const state = getServerPairingState();
  switch (state.kind) {
    case "idle":
      return [
        {
          label: "Pair a device…",
          click: () => {
            startServerPairing().catch(() => undefined);
          },
        },
      ];
    case "armed":
      return [
        { label: "Pairing code copied to clipboard", enabled: false },
        { label: "Waiting for a device to connect…", enabled: false },
        { label: "Cancel pairing", click: () => cancelServerPairing() },
      ];
    case "awaiting_sas":
      return [
        { label: `Confirm this matches: ${state.sas}`, enabled: false },
        {
          label: "Approve — full control",
          click: () => {
            confirmServerPairing({ admin: true, control: true }).catch(
              () => undefined,
            );
          },
        },
        {
          label: "Approve — view only",
          click: () => {
            confirmServerPairing({ admin: false, control: false }).catch(
              () => undefined,
            );
          },
        },
        { label: "Reject", click: () => cancelServerPairing() },
      ];
    case "paired":
      return [
        { label: `Paired with ${state.label}`, enabled: false },
        { label: "Dismiss", click: () => dismissServerPairing() },
      ];
    case "error":
      return [
        { label: `Pairing failed: ${state.message}`, enabled: false },
        { label: "Dismiss", click: () => dismissServerPairing() },
      ];
  }
}

function refreshTray(): void {
  if (!tray) {
    return;
  }

  const active = hasActiveAgents();
  if (active !== lastActive) {
    tray.setImage(loadTrayImage(active));
    lastActive = active;
  }

  let total = 0;
  let running = 0;
  for (const a of appState.agents.values()) {
    if (a.prewarmed) {
      continue;
    }
    total += 1;
    if (isAgentActive(a)) {
      running += 1;
    }
  }
  const name = isServerMode() ? "Argus Server" : "Argus";
  tray.setToolTip(
    total === 0
      ? `${name} — no agents running`
      : `${name} — ${running}/${total} agent${total === 1 ? "" : "s"} active`,
  );

  // Rebuild the dropdown so the next click reflects current state. We do this
  // here rather than only on `click` so right-click and accessibility
  // activations also see fresh data.
  tray.setContextMenu(buildMenu());
}

/** Create the tray item. macOS only — no-ops elsewhere. */
export function initTray(initHooks: TrayHooks): void {
  if (process.platform !== "darwin") {
    return;
  }
  if (tray) {
    return;
  }

  hooks = initHooks;
  tray = new Tray(loadTrayImage(false));
  // Pairing changes are event-driven; the 1.5s agent poll is too slow to watch
  // a SAS appear while someone is standing at the machine.
  setServerPairingListener(() => refreshTray());
  tray.setIgnoreDoubleClickEvents(true);
  refreshTray();

  // Poll the agent map for status changes. Cheap (a handful of map iterations)
  // and decoupled from the dozens of places that mutate agent state.
  pollTimer = setInterval(refreshTray, 1500);
}

/** Force an immediate refresh — used by external callers if they want it. */
export function refreshTrayNow(): void {
  refreshTray();
}

export function destroyTray(): void {
  setServerPairingListener(null);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  hooks = null;
  lastActive = false;
}
