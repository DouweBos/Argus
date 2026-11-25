import { defineTypedCommand } from "../services/command/registry";
import { createSlackApp, forgetSlackApp } from "../services/slack/appSetup";
import { slackManifestJson } from "../services/slack/manifest";
import {
  addAllowedUser,
  connectSlack,
  disconnectSlack,
  listSlackChannels,
  removeAllowedUser,
  resetOwner,
  setChannelProject,
  setDefaultProject,
  slackStatus,
} from "../services/slack/service";

export function registerSlackCommands(): void {
  defineTypedCommand("slack_status", () => slackStatus());
  defineTypedCommand("slack_connect", (p) =>
    connectSlack(p.botToken, p.appToken),
  );
  defineTypedCommand("slack_disconnect", () => disconnectSlack());
  defineTypedCommand("slack_manifest", (p) => slackManifestJson(p.name));
  defineTypedCommand("slack_create_app", (p) =>
    createSlackApp(p.configToken, p.name),
  );
  defineTypedCommand("slack_forget_app", () => forgetSlackApp());
  defineTypedCommand("slack_list_channels", () => listSlackChannels());
  defineTypedCommand("slack_set_default_project", (p) =>
    setDefaultProject(p.repoRoot),
  );
  defineTypedCommand("slack_set_channel_project", (p) =>
    setChannelProject(p.channelId, p.channelName, p.repoRoot),
  );
  defineTypedCommand("slack_add_allowed_user", (p) => addAllowedUser(p.userId));
  defineTypedCommand("slack_remove_allowed_user", (p) =>
    removeAllowedUser(p.userId),
  );
  defineTypedCommand("slack_reset_owner", () => resetOwner());
}
