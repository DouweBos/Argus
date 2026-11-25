import { defineTypedCommand } from "../services/command/registry";
import { createSlackApp, forgetSlackApp } from "../services/slack/appSetup";
import { slackManifestJson } from "../services/slack/manifest";
import {
  addAllowedUser,
  connectSlack,
  disconnectSlack,
  listSlackChannels,
  removeAllowedUser,
  removeWorkspace,
  resetOwner,
  setChannelProject,
  setDefaultProject,
  slackOverview,
} from "../services/slack/service";

export function registerSlackCommands(): void {
  defineTypedCommand("slack_status", () => slackOverview());
  defineTypedCommand("slack_connect", (p) =>
    connectSlack(p.botToken, p.appToken),
  );
  defineTypedCommand("slack_disconnect", (p) => disconnectSlack(p.teamId));
  defineTypedCommand("slack_remove_workspace", (p) =>
    removeWorkspace(p.teamId),
  );
  defineTypedCommand("slack_manifest", (p) => slackManifestJson(p.name));
  defineTypedCommand("slack_create_app", (p) =>
    createSlackApp(p.configToken, p.name),
  );
  defineTypedCommand("slack_forget_app", () => forgetSlackApp());
  defineTypedCommand("slack_list_channels", () => listSlackChannels());
  defineTypedCommand("slack_set_default_project", (p) =>
    setDefaultProject(p.teamId, p.repoRoot),
  );
  defineTypedCommand("slack_set_channel_project", (p) =>
    setChannelProject(p.teamId, p.channelId, p.channelName, p.repoRoot),
  );
  defineTypedCommand("slack_add_allowed_user", (p) =>
    addAllowedUser(p.teamId, p.userId),
  );
  defineTypedCommand("slack_remove_allowed_user", (p) =>
    removeAllowedUser(p.teamId, p.userId),
  );
  defineTypedCommand("slack_reset_owner", (p) => resetOwner(p.teamId));
}
