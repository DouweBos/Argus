import { z } from "zod";

/** A Slack member allowed to drive agents from Slack. */
export const SlackUser = z.object({
  user_id: z.string(),
  /** Display name when Slack told us; null when it didn't. */
  name: z.string().nullable(),
});
export type SlackUser = z.infer<typeof SlackUser>;

/** A channel whose mentions start agents in one project. */
export const SlackChannelMapping = z.object({
  channel_id: z.string(),
  channel_name: z.string(),
  repo_root: z.string(),
});
export type SlackChannelMapping = z.infer<typeof SlackChannelMapping>;

/** A channel the bot can see, for picking one in Settings. */
export const SlackChannel = z.object({
  id: z.string(),
  name: z.string(),
  is_private: z.boolean(),
  /** The bot is in it; it only hears mentions in channels it was invited to. */
  is_member: z.boolean(),
});
export type SlackChannel = z.infer<typeof SlackChannel>;

/** The app Argus created in the workspace, for links to its Slack pages. */
export const SlackApp = z.object({ id: z.string(), name: z.string() });
export type SlackApp = z.infer<typeof SlackApp>;

export const SlackConnectionState = z.enum([
  "off",
  "connecting",
  "connected",
  "error",
]);
export type SlackConnectionState = z.infer<typeof SlackConnectionState>;

export const SlackStatus = z.object({
  /** Tokens are saved. */
  configured: z.boolean(),
  state: SlackConnectionState,
  /** Why the socket is down, as a sentence. */
  error: z.string().nullable(),
  workspace: z.string().nullable(),
  bot_name: z.string().nullable(),
  /** The member who claimed the bot; drives it when `allowed_users` is empty. */
  owner: SlackUser.nullable(),
  /**
   * What to DM the bot to claim it, until someone does. Never sent to paired
   * devices: whoever sends it becomes the owner.
   */
  claim_code: z.string().nullable(),
  /** Used for channels with no mapping and DMs; null asks in the thread. */
  default_project: z.string().nullable(),
  mappings: z.array(SlackChannelMapping),
  allowed_users: z.array(SlackUser),
  /** Slack threads tied to an agent. */
  thread_count: z.number(),
  /** Set once Argus created the app; optional so older hosts still decode. */
  app: SlackApp.nullish(),
});
export type SlackStatus = z.infer<typeof SlackStatus>;

/** A channel named by an automation: its trigger or where its report goes. */
export const SlackChannelRef = z.object({ id: z.string(), name: z.string() });
export type SlackChannelRef = z.infer<typeof SlackChannelRef>;

/** `keyword`: the message contains `text`; `prefix`: it starts with it. */
export const SlackTriggerMatch = z.enum(["any", "keyword", "prefix"]);
export type SlackTriggerMatch = z.infer<typeof SlackTriggerMatch>;
