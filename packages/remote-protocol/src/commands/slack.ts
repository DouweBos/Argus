import { z } from "zod";
import { SlackChannel, SlackOverview } from "../models/slack";
import { type CommandSpec, NoParams } from "./spec";

/** A Slack workspace's ID (`T…`). */
const Team = { teamId: z.string() };

export const SLACK_COMMANDS = {
  slack_status: { tier: "admin", params: NoParams, result: SlackOverview },
  /**
   * Checks both tokens with Slack, saves them sealed and opens the socket.
   * Adds the workspace, or reconnects it when Argus already knows it.
   */
  slack_connect: {
    tier: "admin",
    params: z.object({ botToken: z.string(), appToken: z.string() }),
    result: SlackOverview,
  },
  /** Closes the workspace's socket and deletes its tokens; mappings and users stay. */
  slack_disconnect: {
    tier: "admin",
    params: z.object(Team),
    result: SlackOverview,
  },
  /** Forgets the workspace entirely, its owner, members and channels too. */
  slack_remove_workspace: {
    tier: "admin",
    params: z.object(Team),
    result: SlackOverview,
  },
  /** The app manifest to paste into Slack, as JSON; `name` defaults to Argus. */
  slack_manifest: {
    tier: "admin",
    params: z.object({ name: z.string().optional() }),
    result: z.string(),
  },
  /**
   * Creates the Slack app with an app configuration token, used once and
   * never saved. The tokens still come from Slack: it has no API for them.
   */
  slack_create_app: {
    tier: "admin",
    params: z.object({ configToken: z.string(), name: z.string() }),
    result: SlackOverview,
  },
  /** Forgets the created app, to start over; the app stays in Slack. */
  slack_forget_app: { tier: "admin", params: NoParams, result: SlackOverview },
  /** Every connected workspace's channels. */
  slack_list_channels: {
    tier: "admin",
    params: NoParams,
    result: z.array(SlackChannel),
  },
  /** Null asks which project in the thread. */
  slack_set_default_project: {
    tier: "admin",
    params: z.object({ ...Team, repoRoot: z.string().nullable() }),
    result: SlackOverview,
  },
  /** A null `repoRoot` removes the channel's mapping. */
  slack_set_channel_project: {
    tier: "admin",
    params: z.object({
      ...Team,
      channelId: z.string(),
      channelName: z.string(),
      repoRoot: z.string().nullable(),
    }),
    result: SlackOverview,
  },
  /** `userId` is a Slack member ID (`U…`); the name is looked up. */
  slack_add_allowed_user: {
    tier: "admin",
    params: z.object({ ...Team, userId: z.string() }),
    result: SlackOverview,
  },
  slack_remove_allowed_user: {
    tier: "admin",
    params: z.object({ ...Team, userId: z.string() }),
    result: SlackOverview,
  },
  /** Forget the owner and mint a new claim code. */
  slack_reset_owner: {
    tier: "admin",
    params: z.object(Team),
    result: SlackOverview,
  },
} as const satisfies Record<string, CommandSpec>;
