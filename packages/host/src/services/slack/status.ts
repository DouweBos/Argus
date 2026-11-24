/**
 * The Slack connection's status, kept apart from the service so the gateway
 * can read it without pulling in the agent stack.
 */

import type { SlackConnectionState, SlackStatus } from "@argus/remote-protocol";
import { hasSlackTokens, loadSlackConfig, loadSlackIdentity } from "./store";
import { SlackThreadStore } from "./threads";

export const slackThreads = new SlackThreadStore();

const connection: { state: SlackConnectionState; error: string | null } = {
  state: "off",
  error: null,
};

export function connectionState(): {
  state: SlackConnectionState;
  error: string | null;
} {
  return { ...connection };
}

export function setConnectionState(
  state: SlackConnectionState,
  error: string | null,
): void {
  connection.state = state;
  connection.error = error;
}

export function slackStatus(): SlackStatus {
  const config = loadSlackConfig();
  const identity = loadSlackIdentity();
  const configured = hasSlackTokens();

  return {
    configured,
    state: configured ? connection.state : "off",
    error: configured ? connection.error : null,
    workspace: configured ? (identity?.workspace ?? null) : null,
    bot_name: configured ? (identity?.botName ?? null) : null,
    owner: config.owner,
    claim_code: configured ? config.claimCode : null,
    default_project: config.defaultProject,
    mappings: config.mappings,
    allowed_users: config.allowedUsers,
    thread_count: slackThreads.all().filter((t) => t.sessionId).length,
  };
}

/** What a paired device may see: everything but the claim code. */
export function remoteSlackStatus(): SlackStatus {
  return { ...slackStatus(), claim_code: null };
}
