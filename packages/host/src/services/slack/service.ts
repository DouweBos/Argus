/**
 * The Slack integration's lifecycle: connect (check both tokens, seal them),
 * keep the Socket Mode connection up while the host runs, and the config the
 * Mac's Settings edits. Tokens are never logged or sent to a client.
 */

import type { AutomationRun } from "../automation/models";
import type {
  SlackChannel,
  SlackConnectionState,
  SlackOverview,
} from "@argus/remote-protocol";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { respondToPermission } from "../agent/agentService";
import { fireAutomationFromEvent } from "../automation/eventDispatch";
import { getAutomation, listAutomations } from "../automation/manager";
import { capture } from "../telemetry/telemetry";
import { SlackApi, SlackApiError } from "./api";
import {
  type ChannelMessage,
  fireSlackTriggers,
  ReportPoster,
} from "./automations";
import { SlackBot } from "./bot";
import { SocketModeClient } from "./socket";
import {
  connectionState,
  forgetSlackThreads,
  setConnectionState,
  slackOverview,
  slackThreads,
} from "./status";
import {
  deleteSlackTokens,
  hasSlackTokens,
  listSlackWorkspaces,
  loadSlackConfig,
  newClaimCode,
  readSlackTokens,
  removeSlackWorkspace,
  saveSlackTokens,
  type SlackConfig,
  updateSlackConfig,
} from "./store";
import { hostDeps } from "./wiring";

export { remoteSlackStatus, slackOverview } from "./status";

export const SLACK_STATUS_CHANGED = "slack_status_changed";

/** One connected workspace: its bot, socket and Web API client. */
interface Workspace {
  socket: SocketModeClient;
  bot: SlackBot;
  api: SlackApi;
}

const workspaces = new Map<string, Workspace>();
let unsubscribe: (() => void) | null = null;
const reports = new ReportPoster({
  api: (teamId) =>
    (teamId ? workspaces.get(teamId) : workspaces.values().next().value)?.api ??
    null,
  automation: (id) => getAutomation(id) ?? null,
  onPosted: (success) => capture("slack_report_posted", { success }),
  now: Date.now,
});

/** Slack-triggered automations. */
function fireAutomations(message: ChannelMessage): void {
  const fired = fireSlackTriggers({
    message,
    config: loadSlackConfig(message.teamId),
    automations: listAutomations(),
    // Queued and capped per hour like any event trigger; the run reads the message fenced.
    fire: (id, event) => {
      fireAutomationFromEvent(id, event);
    },
    now: Date.now(),
  });
  if (fired.length) {
    capture("slack_automation_fired", { count: fired.length });
  }
}

function announce(): void {
  emitHostEvent(SLACK_STATUS_CHANGED, slackOverview());
}

function setState(
  teamId: string,
  next: SlackConnectionState,
  error: string | null,
): void {
  const current = connectionState(teamId);
  if (next === current.state && error === current.error) {
    return;
  }
  const wasRejected = next === "error" && error?.includes("rejected");
  setConnectionState(teamId, next, error);
  if (wasRejected) {
    capture("slack_disconnected", { reason: "rejected" });
  }
  announce();
}

/** The bridges hear agent events; finished runs post their reports. */
function listen(): void {
  if (unsubscribe) {
    return;
  }
  unsubscribe = addHostEventSink((channel, args) => {
    if (channel.startsWith("agent:")) {
      for (const w of workspaces.values()) {
        w.bot.bridge.handleHostEvent(channel, args[0]);
      }
    } else if (channel === "automation_run:changed") {
      reports
        .runChanged(args[0] as AutomationRun | null)
        .catch(() => undefined);
    }
  });
}

function startWorkspace(teamId: string): void {
  if (workspaces.has(teamId)) {
    return;
  }
  const tokens = readSlackTokens(teamId);
  if (!tokens) {
    return;
  }
  const api = new SlackApi(tokens.bot);
  const appApi = new SlackApi(tokens.app);
  const bot = new SlackBot(
    hostDeps(
      teamId,
      api,
      slackThreads(teamId),
      respondToPermission,
      (message) => fireAutomations({ ...message, teamId }),
      announce,
    ),
  );
  const socket = new SocketModeClient({
    openConnection: () => appApi.openConnection(),
    onEnvelope: (envelope) => {
      bot.handleEnvelope(envelope).catch(() => undefined);
    },
    onState: (state, error) => setState(teamId, state, error),
  });
  workspaces.set(teamId, { socket, bot, api });
  listen();
  socket.start();
  info("[slack] connecting a workspace");
}

function stopWorkspace(teamId: string): void {
  const w = workspaces.get(teamId);
  if (w) {
    w.socket.stop();
    w.bot.dispose();
    workspaces.delete(teamId);
  }
  setConnectionState(teamId, "off", null);
  if (!workspaces.size) {
    unsubscribe?.();
    unsubscribe = null;
  }
}

/** Connects every workspace with saved tokens. */
export function startSlack(): void {
  for (const { identity, connected } of listSlackWorkspaces()) {
    if (connected) {
      startWorkspace(identity.teamId);
    }
  }
}

export function stopSlack(): void {
  for (const teamId of [...workspaces.keys()]) {
    stopWorkspace(teamId);
  }
}

function sentence(e: unknown): string {
  if (typeof e === "string") {
    return e;
  }

  return e instanceof Error ? e.message : String(e);
}

export async function connectSlack(
  botToken: string,
  appToken: string,
): Promise<SlackOverview> {
  const botSecret = botToken.trim();
  const appSecret = appToken.trim();
  if (!botSecret.startsWith("xoxb-")) {
    throw "The bot token starts with xoxb-. Find it under OAuth & Permissions.";
  }
  if (!appSecret.startsWith("xapp-")) {
    throw "The app-level token starts with xapp-. Create one under Basic Information → App-Level Tokens.";
  }
  let teamId: string;
  try {
    const who = await new SlackApi(botSecret).authTest().catch((e: unknown) => {
      throw e instanceof SlackApiError && e.isAuth
        ? "Slack didn't accept the bot token."
        : `Couldn't reach Slack: ${sentence(e)}`;
    });
    await new SlackApi(appSecret).openConnection().catch((e: unknown) => {
      throw e instanceof SlackApiError && e.isAuth
        ? "Slack didn't accept the app-level token. Give it the connections:write scope and turn on Socket Mode."
        : `Couldn't open a Socket Mode connection: ${sentence(e)}`;
    });
    saveSlackTokens(
      { bot: botSecret, app: appSecret },
      {
        teamId: who.teamId,
        workspace: who.team,
        botUserId: who.userId,
        botName: who.user,
      },
    );
    teamId = who.teamId;
  } catch (e) {
    capture("slack_connected", {
      success: false,
      workspaces: listSlackWorkspaces().length,
    });
    throw sentence(e);
  }
  capture("slack_connected", {
    success: true,
    workspaces: listSlackWorkspaces().length,
  });
  stopWorkspace(teamId);
  startWorkspace(teamId);
  announce();

  return slackOverview();
}

export function disconnectSlack(teamId: string): SlackOverview {
  const wasConnected = hasSlackTokens(teamId);
  stopWorkspace(teamId);
  deleteSlackTokens(teamId);
  if (wasConnected) {
    capture("slack_disconnected", { reason: "user" });
  }
  announce();

  return slackOverview();
}

export function removeWorkspace(teamId: string): SlackOverview {
  disconnectSlack(teamId);
  removeSlackWorkspace(teamId);
  forgetSlackThreads(teamId);
  announce();

  return slackOverview();
}

function changeConfig(
  teamId: string,
  fn: (config: SlackConfig) => SlackConfig,
): SlackOverview {
  if (!listSlackWorkspaces().some((w) => w.identity.teamId === teamId)) {
    throw "Argus doesn't know that Slack workspace.";
  }
  updateSlackConfig(teamId, fn);
  announce();

  return slackOverview();
}

export function setDefaultProject(
  teamId: string,
  repoRoot: string | null,
): SlackOverview {
  return changeConfig(teamId, (c) => ({ ...c, defaultProject: repoRoot }));
}

export function setChannelProject(
  teamId: string,
  channelId: string,
  channelName: string,
  repoRoot: string | null,
): SlackOverview {
  return changeConfig(teamId, (c) => {
    const rest = c.mappings.filter((m) => m.channel_id !== channelId);

    return {
      ...c,
      mappings: repoRoot
        ? [
            ...rest,
            {
              channel_id: channelId,
              channel_name: channelName,
              repo_root: repoRoot,
            },
          ].sort((a, b) => a.channel_name.localeCompare(b.channel_name))
        : rest,
    };
  });
}

export async function addAllowedUser(
  teamId: string,
  userId: string,
): Promise<SlackOverview> {
  const id = userId.trim().toUpperCase();
  if (!/^[UW][A-Z0-9]{2,}$/.test(id)) {
    throw "That isn't a Slack member ID. Copy it from the member's profile → ⋯ → Copy member ID.";
  }
  const api = workspaces.get(teamId)?.api;
  const name = api ? await api.userName(id) : null;

  return changeConfig(teamId, (c) => ({
    ...c,
    allowedUsers: [
      ...c.allowedUsers.filter((u) => u.user_id !== id),
      { user_id: id, name },
    ],
  }));
}

export function removeAllowedUser(
  teamId: string,
  userId: string,
): SlackOverview {
  return changeConfig(teamId, (c) => ({
    ...c,
    allowedUsers: c.allowedUsers.filter((u) => u.user_id !== userId),
  }));
}

export function resetOwner(teamId: string): SlackOverview {
  return changeConfig(teamId, (c) => ({
    ...c,
    owner: null,
    claimCode: newClaimCode(),
  }));
}

/** Every connected workspace's channels; one that fails is left out. */
export async function listSlackChannels(): Promise<SlackChannel[]> {
  if (!workspaces.size) {
    throw "Connect Slack first.";
  }
  const names = new Map(
    listSlackWorkspaces().map((w) => [w.identity.teamId, w.identity.workspace]),
  );
  const lists = await Promise.all(
    [...workspaces].map(async ([teamId, w]) => {
      try {
        return (await w.api.listChannels()).map((c) => ({
          ...c,
          team_id: teamId,
          workspace: names.get(teamId) ?? "Slack",
        }));
      } catch (e) {
        warn(`[slack] listing a workspace's channels failed: ${sentence(e)}`);

        return null;
      }
    }),
  );
  if (lists.every((l) => l === null)) {
    throw "Couldn't list the workspace's channels.";
  }

  return lists.flatMap((l) => l ?? []);
}
