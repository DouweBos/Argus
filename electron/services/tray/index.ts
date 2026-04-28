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

import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import { Menu, Tray, app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";

let tray: Tray | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastActive = false;

const isDev = !app.isPackaged;

interface TrayHooks {
  /** Show + focus the main window and navigate to the given path. */
  navigateMainWindow: (path: string) => void;
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

function sessionLabel(session: Session): string {
  const name =
    session.display_name?.trim() || session.branch || "Untitled session";
  const project = projectName(session);

  return project ? `${project} · ${name}` : name;
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

function navigateToSession(sessionId: string): void {
  if (!hooks) {
    return;
  }
  hooks.navigateMainWindow(`/sessions/${sessionId}`);
}

function buildMenu(): Menu {
  const grouped = new Map<string, AgentSession[]>();
  for (const agent of appState.agents.values()) {
    const list = grouped.get(agent.sessionId) ?? [];
    list.push(agent);
    grouped.set(agent.sessionId, list);
  }

  const template: Electron.MenuItemConstructorOptions[] = [];
  let runningCount = 0;
  for (const a of appState.agents.values()) {
    if (isAgentActive(a)) {
      runningCount += 1;
    }
  }

  template.push({
    label:
      grouped.size === 0
        ? "No agents running"
        : `${appState.agents.size} agent${appState.agents.size === 1 ? "" : "s"} · ${runningCount} active`,
    enabled: false,
  });
  template.push({ type: "separator" });

  if (grouped.size > 0) {
    // Stable session ordering — newest first by created_at on contained agents.
    const sessionEntries = Array.from(grouped.entries()).sort(
      ([, a], [, b]) => {
        const aMax = Math.max(...a.map((x) => x.createdAt));
        const bMax = Math.max(...b.map((x) => x.createdAt));

        return bMax - aMax;
      },
    );

    for (const [sessionId, agents] of sessionEntries) {
      const session = appState.sessions.get(sessionId);
      const label = session ? sessionLabel(session) : "Session";
      const sessionRunning = agents.some(isAgentActive);

      template.push({
        label: `${sessionRunning ? "● " : "○ "}${label}  (${agents.length})`,
        click: () => navigateToSession(sessionId),
        submenu: agents
          .slice()
          .sort((a, b) => a.createdAt - b.createdAt)
          .map<Electron.MenuItemConstructorOptions>((agent) => ({
            label: `${isAgentActive(agent) ? "● " : "○ "}${agentLabel(agent.agentId)}`,
            click: () => navigateToSession(sessionId),
          })),
      });
    }
  }

  template.push({ type: "separator" });
  template.push({
    label: "Show Argus",
    click: () => hooks?.navigateMainWindow("/"),
  });
  template.push({ role: "quit" });

  return Menu.buildFromTemplate(template);
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

  const total = appState.agents.size;
  let running = 0;
  for (const a of appState.agents.values()) {
    if (isAgentActive(a)) {
      running += 1;
    }
  }
  tray.setToolTip(
    total === 0
      ? "Argus — no agents running"
      : `Argus — ${running}/${total} agent${total === 1 ? "" : "s"} active`,
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
