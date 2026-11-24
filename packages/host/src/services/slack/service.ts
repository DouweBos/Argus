/**
 * The Slack integration's lifecycle: connect (check both tokens, seal them),
 * keep the Socket Mode connection up while the host runs, and the config the
 * Mac's Settings edits. Tokens are never logged or sent to a client.
 */

import type { AutomationRun } from "../automation/models";
import type {
  SlackChannel,
  SlackConnectionState,
  SlackStatus,
} from "@argus/remote-protocol";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { respondToPermission } from "../agent/agentService";
import { fireAutomationFromEvent } from "../automation/eventDispatch";
import { getAutomation, listAutomations } from "../automation/manager";
import { capture } from "../telemetry/telemetry";
import { SlackApi, SlackApiError } from "./api";
import { fireSlackTriggers, ReportPoster } from "./automations";
import { SlackBot } from "./bot";
import { SocketModeClient } from "./socket";
import {
  connectionState,
  setConnectionState,
  slackStatus,
  slackThreads as threads,
} from "./status";
import {
  deleteSlackTokens,
  hasSlackTokens,
  loadSlackConfig,
  newClaimCode,
  readSlackTokens,
  saveSlackTokens,
  type SlackConfig,
  updateSlackConfig,
} from "./store";
import { hostDeps } from "./wiring";

export { remoteSlackStatus, slackStatus } from "./status";

export const SLACK_STATUS_CHANGED = "slack_status_changed";

type ChannelMessageListener = NonNullable<
  ConstructorParameters<typeof SlackBot>[0]["onChannelMessage"]
>;

let socket: SocketModeClient | null = null;
let bot: SlackBot | null = null;
let botApi: SlackApi | null = null;
let unsubscribe: (() => void) | null = null;
const channelListeners = new Set<ChannelMessageListener>();
const reports = new ReportPoster({
  api: () => botApi,
  automation: (id) => getAutomation(id) ?? null,
  onPosted: (success) => capture("slack_report_posted", { success }),
  now: Date.now,
});

/** Slack-triggered automations. */
function fireAutomations(message: Parameters<ChannelMessageListener>[0]): void {
  const fired = fireSlackTriggers({
    message,
    config: loadSlackConfig(),
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
  emitHostEvent(SLACK_STATUS_CHANGED, slackStatus());
}

function setState(next: SlackConnectionState, error: string | null): void {
  const current = connectionState();
  if (next === current.state && error === current.error) {
    return;
  }
  const wasRejected = next === "error" && error?.includes("rejected");
  setConnectionState(next, error);
  if (wasRejected) {
    capture("slack_disconnected", { reason: "rejected" });
  }
  announce();
}

/** The bot's Web API client while connected; null otherwise. */
export function slackBotApi(): SlackApi | null {
  return botApi;
}

/** Listen to every human message in channels the bot is in. */
export function onSlackChannelMessage(
  listener: ChannelMessageListener,
): () => void {
  channelListeners.add(listener);

  return () => {
    channelListeners.delete(listener);
  };
}

export function startSlack(): void {
  if (socket) {
    return;
  }
  const tokens = readSlackTokens();
  if (!tokens) {
    return;
  }
  const api = new SlackApi(tokens.bot);
  const appApi = new SlackApi(tokens.app);
  botApi = api;
  bot = new SlackBot(
    hostDeps(
      api,
      threads,
      respondToPermission,
      (message) => {
        fireAutomations(message);
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch (e) {
            warn(`[slack] channel listener failed: ${String(e)}`);
          }
        }
      },
      announce,
    ),
  );
  const current = bot;
  unsubscribe = addHostEventSink((channel, args) => {
    if (channel.startsWith("agent:")) {
      current.bridge.handleHostEvent(channel, args[0]);
    } else if (channel === "automation_run:changed") {
      reports
        .runChanged(args[0] as AutomationRun | null)
        .catch(() => undefined);
    }
  });
  socket = new SocketModeClient({
    openConnection: () => appApi.openConnection(),
    onEnvelope: (envelope) => {
      current.handleEnvelope(envelope).catch(() => undefined);
    },
    onState: setState,
  });
  socket.start();
  info("[slack] connecting");
}

export function stopSlack(): void {
  socket?.stop();
  socket = null;
  unsubscribe?.();
  unsubscribe = null;
  bot?.dispose();
  bot = null;
  botApi = null;
  setConnectionState("off", null);
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
): Promise<SlackStatus> {
  const botSecret = botToken.trim();
  const appSecret = appToken.trim();
  if (!botSecret.startsWith("xoxb-")) {
    throw "The bot token starts with xoxb-. Find it under OAuth & Permissions.";
  }
  if (!appSecret.startsWith("xapp-")) {
    throw "The app-level token starts with xapp-. Create one under Basic Information → App-Level Tokens.";
  }
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
  } catch (e) {
    capture("slack_connected", { success: false });
    throw sentence(e);
  }
  capture("slack_connected", { success: true });
  stopSlack();
  startSlack();
  announce();

  return slackStatus();
}

export function disconnectSlack(): SlackStatus {
  const wasConnected = hasSlackTokens();
  stopSlack();
  deleteSlackTokens();
  if (wasConnected) {
    capture("slack_disconnected", { reason: "user" });
  }
  announce();

  return slackStatus();
}

function changeConfig(fn: (config: SlackConfig) => SlackConfig): SlackStatus {
  updateSlackConfig(fn);
  announce();

  return slackStatus();
}

export function setDefaultProject(repoRoot: string | null): SlackStatus {
  return changeConfig((c) => ({ ...c, defaultProject: repoRoot }));
}

export function setChannelProject(
  channelId: string,
  channelName: string,
  repoRoot: string | null,
): SlackStatus {
  return changeConfig((c) => {
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

export async function addAllowedUser(userId: string): Promise<SlackStatus> {
  const id = userId.trim().toUpperCase();
  if (!/^[UW][A-Z0-9]{2,}$/.test(id)) {
    throw "That isn't a Slack member ID. Copy it from the member's profile → ⋯ → Copy member ID.";
  }
  const name = botApi ? await botApi.userName(id) : null;

  return changeConfig((c) => ({
    ...c,
    allowedUsers: [
      ...c.allowedUsers.filter((u) => u.user_id !== id),
      { user_id: id, name },
    ],
  }));
}

export function removeAllowedUser(userId: string): SlackStatus {
  return changeConfig((c) => ({
    ...c,
    allowedUsers: c.allowedUsers.filter((u) => u.user_id !== userId),
  }));
}

export function resetOwner(): SlackStatus {
  return changeConfig((c) => ({
    ...c,
    owner: null,
    claimCode: newClaimCode(),
  }));
}

export async function listSlackChannels(): Promise<SlackChannel[]> {
  if (!botApi) {
    throw "Connect Slack first.";
  }
  try {
    return await botApi.listChannels();
  } catch (e) {
    warn(`[slack] listing channels failed: ${sentence(e)}`);
    throw "Couldn't list the workspace's channels.";
  }
}
