import { z } from "zod";
import { SlackChannel, SlackStatus } from "../models/slack";
import { type CommandSpec, NoParams } from "./spec";

export const SLACK_COMMANDS = {
  slack_status: { tier: "admin", params: NoParams, result: SlackStatus },
  /** Checks both tokens with Slack, saves them sealed and opens the socket. */
  slack_connect: {
    tier: "admin",
    params: z.object({ botToken: z.string(), appToken: z.string() }),
    result: SlackStatus,
  },
  /** Closes the socket and deletes the tokens; mappings and users stay. */
  slack_disconnect: { tier: "admin", params: NoParams, result: SlackStatus },
  /** The app manifest to paste into Slack, as JSON. */
  slack_manifest: { tier: "admin", params: NoParams, result: z.string() },
  slack_list_channels: {
    tier: "admin",
    params: NoParams,
    result: z.array(SlackChannel),
  },
  /** Null asks which project in the thread. */
  slack_set_default_project: {
    tier: "admin",
    params: z.object({ repoRoot: z.string().nullable() }),
    result: SlackStatus,
  },
  /** A null `repoRoot` removes the channel's mapping. */
  slack_set_channel_project: {
    tier: "admin",
    params: z.object({
      channelId: z.string(),
      channelName: z.string(),
      repoRoot: z.string().nullable(),
    }),
    result: SlackStatus,
  },
  /** `userId` is a Slack member ID (`U…`); the name is looked up. */
  slack_add_allowed_user: {
    tier: "admin",
    params: z.object({ userId: z.string() }),
    result: SlackStatus,
  },
  slack_remove_allowed_user: {
    tier: "admin",
    params: z.object({ userId: z.string() }),
    result: SlackStatus,
  },
  /** Forget the owner and mint a new claim code. */
  slack_reset_owner: { tier: "admin", params: NoParams, result: SlackStatus },
} as const satisfies Record<string, CommandSpec>;
