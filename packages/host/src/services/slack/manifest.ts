/**
 * The Slack app manifest people paste into api.slack.com/apps → Create New
 * App → From a manifest. Socket Mode on, so Slack needs no URL to reach.
 */

export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "files:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "users:read",
];

export const SLACK_BOT_EVENTS = [
  "app_mention",
  "message.channels",
  "message.groups",
  "message.im",
];

export function slackManifest(): Record<string, unknown> {
  return {
    display_information: {
      name: "Argus",
      description: "Start and steer Argus agents from Slack.",
      background_color: "#1c1c1e",
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: { display_name: "Argus", always_online: true },
    },
    oauth_config: { scopes: { bot: SLACK_BOT_SCOPES } },
    settings: {
      event_subscriptions: { bot_events: SLACK_BOT_EVENTS },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}

export function slackManifestJson(): string {
  return JSON.stringify(slackManifest(), null, 2);
}
