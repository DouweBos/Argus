/**
 * Each Slack workspace's connection status, kept apart from the service so
 * the gateway can read it without pulling in the agent stack.
 */

import type {
  SlackConnectionState,
  SlackOverview,
  SlackStatus,
} from "@argus/remote-protocol";
import {
  listSlackWorkspaces,
  loadPendingSlackApp,
  slackThreadsFile,
} from "./store";
import { SlackThreadStore } from "./threads";

interface Connection {
  state: SlackConnectionState;
  error: string | null;
}

const connections = new Map<string, Connection>();
const threadStores = new Map<string, SlackThreadStore>();

/** The workspace's Slack threads, one file each. */
export function slackThreads(teamId: string): SlackThreadStore {
  let store = threadStores.get(teamId);
  if (!store) {
    store = new SlackThreadStore(() => slackThreadsFile(teamId));
    threadStores.set(teamId, store);
  }

  return store;
}

export function forgetSlackThreads(teamId: string): void {
  threadStores.delete(teamId);
}

export function connectionState(teamId: string): Connection {
  return { ...(connections.get(teamId) ?? { state: "off", error: null }) };
}

export function setConnectionState(
  teamId: string,
  state: SlackConnectionState,
  error: string | null,
): void {
  connections.set(teamId, { state, error });
}

function offStatus(): SlackStatus {
  return {
    team_id: null,
    configured: false,
    state: "off",
    error: null,
    workspace: null,
    bot_name: null,
    owner: null,
    claim_code: null,
    default_project: null,
    mappings: [],
    allowed_users: [],
    thread_count: 0,
    app: null,
  };
}

export function slackOverview(): SlackOverview {
  return {
    workspaces: listSlackWorkspaces().map(
      ({ identity, config, connected, app }) => {
        const connection = connectionState(identity.teamId);

        return {
          team_id: identity.teamId,
          configured: connected,
          state: connected ? connection.state : "off",
          error: connected ? connection.error : null,
          workspace: identity.workspace,
          bot_name: identity.botName,
          owner: config.owner,
          claim_code: connected ? config.claimCode : null,
          default_project: config.defaultProject,
          mappings: config.mappings,
          allowed_users: config.allowedUsers,
          thread_count: slackThreads(identity.teamId)
            .all()
            .filter((t) => t.sessionId).length,
          app,
        };
      },
    ),
    pending_app: loadPendingSlackApp(),
  };
}

/**
 * What a paired device may see: everything but the claim codes. `status` is
 * the first workspace, for phones from before there were several.
 */
export function remoteSlackStatus(): {
  status: SlackStatus;
  workspaces: SlackStatus[];
} {
  const workspaces = slackOverview().workspaces.map((w) => ({
    ...w,
    claim_code: null,
  }));

  return { status: workspaces[0] ?? offStatus(), workspaces };
}
