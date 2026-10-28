import { z } from "zod";
import { ImageAttachment } from "./agents";

export const IntegrationId = z.enum(["linear", "figma"]);
export type IntegrationId = z.infer<typeof IntegrationId>;

/** Who the stored credential signs in as. */
export const IntegrationAccount = z.object({
  name: z.string(),
  email: z.string().nullable(),
  /** Linear workspace or Figma team, when the service has one. */
  workspace: z.string().nullable(),
});
export type IntegrationAccount = z.infer<typeof IntegrationAccount>;

export const IntegrationStatus = z.object({
  id: IntegrationId,
  connected: z.boolean(),
  method: z.enum(["key", "oauth"]).nullable(),
  account: IntegrationAccount.nullable(),
  /** The credential stopped working; the user has to connect again. */
  needsReauth: z.boolean(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

/** The tracker issue a session was started from. */
export const LinkedIssue = z.object({
  source: z.literal("linear"),
  /** `ENG-123`. */
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
});
export type LinkedIssue = z.infer<typeof LinkedIssue>;

/** A Figma frame the session's work should match. */
export const DesignRef = z.object({
  url: z.string(),
  fileKey: z.string(),
  /** `12:34`; null when the link names the whole file. */
  nodeId: z.string().nullable(),
  name: z.string(),
});
export type DesignRef = z.infer<typeof DesignRef>;

/** A rendered Figma frame. */
export const FigmaFrame = z.object({
  name: z.string(),
  /** PNG, base64, rendered at 2x. */
  image: z.string(),
  /** Frame size in points. */
  width: z.number(),
  height: z.number(),
});
export type FigmaFrame = z.infer<typeof FigmaFrame>;

export const LinearIssue = z.object({
  id: z.string(),
  /** `ENG-123`. */
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  /** Linear's own branch name — using it lets Linear's GitHub integration link the PR. */
  branchName: z.string(),
  state: z.object({ name: z.string(), type: z.string() }),
  /** Linear's 0–4, where 1 is urgent and 0 is none. */
  priority: z.number(),
  teamKey: z.string(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()),
  /** Epoch milliseconds. */
  updatedAt: z.number(),
});
export type LinearIssue = z.infer<typeof LinearIssue>;

export const LinearComment = z.object({
  author: z.string().nullable(),
  body: z.string(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
});
export type LinearComment = z.infer<typeof LinearComment>;

export const LinearIssueDetail = LinearIssue.extend({
  comments: z.array(LinearComment),
});
export type LinearIssueDetail = z.infer<typeof LinearIssueDetail>;

/** Everything an agent starts from: the issue, its text, and its screenshots. */
export const LinearIssueContext = z.object({
  issue: LinearIssueDetail,
  /** Markdown to put in front of the user's prompt. */
  context: z.string(),
  /** Images embedded in the issue and its comments (at most a handful). */
  images: z.array(ImageAttachment),
  /** figma.com links in the issue and its comments. */
  designUrls: z.array(z.string()),
});
export type LinearIssueContext = z.infer<typeof LinearIssueContext>;
