/**
 * Creating the user's Slack app from an app configuration token, so each
 * person's bot carries their own name. The token is used once, never saved.
 */

import type { SlackOverview } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { SlackApi, SlackApiError, type FetchLike } from "./api";
import { SLACK_APP_NAME_MAX, slackManifest } from "./manifest";
import { SLACK_STATUS_CHANGED } from "./service";
import { slackOverview } from "./status";
import { savePendingSlackApp } from "./store";

function failure(e: unknown): string {
  if (!(e instanceof SlackApiError)) {
    return `Couldn't reach Slack: ${e instanceof Error ? e.message : String(e)}`;
  }
  switch (e.code) {
    case "token_expired":
      return "That configuration token expired. They last 12 hours; generate a new one.";
    case "invalid_auth":
    case "not_authed":
    case "not_allowed_token_type":
      return "Slack didn't accept the configuration token. Copy the access token, not the refresh token.";
    case "invalid_manifest":
      return `Slack rejected the app: ${e.details.join("; ") || "invalid manifest"}.`;
    case "managed_app_limit_reached":
      return "This workspace can't have more apps. Delete one you no longer use in Slack.";
    default:
      return `Slack couldn't create the app (${e.code}).`;
  }
}

export async function createSlackApp(
  configToken: string,
  name: string,
  fetchImpl: FetchLike = fetch,
): Promise<SlackOverview> {
  const token = configToken.trim();
  const appName = name.trim();
  if (!token.startsWith("xoxe.")) {
    throw "The configuration token starts with xoxe.xoxp-. Generate one under Your App Configuration Tokens.";
  }
  if (!appName || appName.length > SLACK_APP_NAME_MAX) {
    throw `Give the bot a name of 1 to ${SLACK_APP_NAME_MAX} characters.`;
  }
  try {
    const { appId } = await new SlackApi(token, fetchImpl).createApp(
      slackManifest(appName),
    );
    savePendingSlackApp({ id: appId, name: appName });
  } catch (e) {
    capture("slack_app_created", { success: false });
    throw failure(e);
  }
  capture("slack_app_created", { success: true });
  info("[slack] created the Slack app");
  emitHostEvent(SLACK_STATUS_CHANGED, slackOverview());

  return slackOverview();
}

export function forgetSlackApp(): SlackOverview {
  savePendingSlackApp(null);
  emitHostEvent(SLACK_STATUS_CHANGED, slackOverview());

  return slackOverview();
}
