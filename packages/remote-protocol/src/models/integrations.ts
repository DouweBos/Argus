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
  /** Argus can sign in through the browser rather than with a pasted key. */
  oauthAvailable: z.boolean(),
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
  /** The Figma file version it was captured at, to tell when the design moved on. */
  version: z.string().nullish(),
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

/** Whose issues: assigned to, created by, or subscribed to by the connected user. */
export const LinearIssueScope = z.enum(["assigned", "created", "subscribed"]);
export type LinearIssueScope = z.infer<typeof LinearIssueScope>;

/** A team's workflow state; `type` is Linear's fixed category. */
export const LinearWorkflowState = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  /** Order within the team's workflow. */
  position: z.number(),
});
export type LinearWorkflowState = z.infer<typeof LinearWorkflowState>;

export const LinearIssue = z.object({
  id: z.string(),
  /** `ENG-123`. */
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  /** Linear's own branch name — using it lets Linear's GitHub integration link the PR. */
  branchName: z.string(),
  state: LinearWorkflowState,
  /** Linear's 0–4, where 1 is urgent and 0 is none. */
  priority: z.number(),
  estimate: z.number().nullable(),
  /** The team's estimate scale: `tShirt`, `fibonacci`, `linear`, `exponential`. */
  estimateType: z.string().nullish(),
  teamId: z.string(),
  teamKey: z.string(),
  teamName: z.string(),
  assignee: z.string().nullable(),
  assigneeAvatarUrl: z.string().nullable(),
  creator: z.string().nullish(),
  /** `YYYY-MM-DD`. */
  dueDate: z.string().nullish(),
  labels: z.array(z.string()),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  cycle: z
    .object({
      id: z.string(),
      number: z.number(),
      name: z.string().nullable(),
      isActive: z.boolean(),
    })
    .nullable(),
  parent: z.object({ identifier: z.string(), title: z.string() }).nullable(),
  /** GitHub/GitLab pull requests attached to the issue. */
  pullRequestCount: z.number(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
  /** Epoch milliseconds. */
  updatedAt: z.number(),
});
export type LinearIssue = z.infer<typeof LinearIssue>;

export const LinearComment = z.object({
  id: z.string().nullish(),
  /** The comment this one replies to; null starts a thread. */
  parentId: z.string().nullish(),
  author: z.string().nullable(),
  authorAvatarUrl: z.string().nullish(),
  /** Emoji with how many people reacted with it. */
  reactions: z
    .array(z.object({ emoji: z.string(), count: z.number() }))
    .nullish(),
  body: z.string(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
});
export type LinearComment = z.infer<typeof LinearComment>;

export const LinearAttachment = z.object({
  title: z.string(),
  /** Epoch milliseconds. */
  createdAt: z.number().nullish(),
  subtitle: z.string().nullable(),
  url: z.string(),
  /** `github`, `gitlab`, `slack`, … when Linear knows. */
  sourceType: z.string().nullable(),
});
export type LinearAttachment = z.infer<typeof LinearAttachment>;

/** One line of an issue's activity: who did what, already phrased. */
export const LinearHistoryEvent = z.object({
  id: z.string(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
  /** Null when Linear itself did it (cycle rollover, automations). */
  actor: z.string().nullable(),
  actorAvatarUrl: z.string().nullable(),
  /** What changed, for the icon. */
  kind: z.enum([
    "assignee",
    "attachment",
    "created",
    "cycle",
    "description",
    "due",
    "estimate",
    "labels",
    "other",
    "parent",
    "priority",
    "project",
    "relation",
    "status",
    "title",
  ]),
  /** "set priority to High" — the actor's name goes in front. */
  text: z.string(),
});
export type LinearHistoryEvent = z.infer<typeof LinearHistoryEvent>;

export const LinearIssueDetail = LinearIssue.extend({
  comments: z.array(LinearComment),
  /** Oldest first, starting with the issue's creation. */
  history: z.array(LinearHistoryEvent).nullish(),
  subscribers: z
    .array(z.object({ name: z.string(), avatarUrl: z.string().nullable() }))
    .nullish(),
  relations: z
    .array(
      z.object({
        /** `related`, `blocks`, `blocked_by`, `duplicate`, `duplicate_of`. */
        type: z.string(),
        identifier: z.string(),
        title: z.string(),
        state: z.object({ name: z.string(), type: z.string() }),
      }),
    )
    .nullish(),
  /** Each status the issue has been in, oldest first, for "time in status". */
  statusHistory: z
    .array(
      z.object({ name: z.string(), type: z.string(), enteredAt: z.number() }),
    )
    .nullish(),
  /** Each label with its Linear color (`#rrggbb`). */
  labelColors: z
    .array(z.object({ name: z.string(), color: z.string() }))
    .nullish(),

  attachments: z.array(LinearAttachment),
  children: z.array(
    z.object({
      identifier: z.string(),
      title: z.string(),
      state: z.object({ name: z.string(), type: z.string() }),
    }),
  ),
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

export const LinearTeam = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});
export type LinearTeam = z.infer<typeof LinearTeam>;

/** One layer of a frame, flattened in drawing order. */
export const FigmaLayer = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  depth: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** Text content, for text layers. */
  text: z.string().nullable(),
  /** First solid fill as `#rrggbb`, when there is one. */
  fill: z.string().nullable(),
  /** `Inter 600 16/24`, for text layers. */
  font: z.string().nullable(),
});
export type FigmaLayer = z.infer<typeof FigmaLayer>;

/** Everything the design viewer shows for a frame. */
export const FigmaFrameDetails = z.object({
  ref: DesignRef,
  frame: FigmaFrame,
  layers: z.array(FigmaLayer),
  comments: z.array(z.object({ author: z.string(), body: z.string() })),
  file: z.object({
    name: z.string(),
    version: z.string(),
    /** Epoch milliseconds. */
    lastModified: z.number(),
  }),
  /** The file's pages and their top-level frames, to move between them. */
  pages: z.array(
    z.object({
      name: z.string(),
      frames: z.array(z.object({ name: z.string(), url: z.string() })),
    }),
  ),
});
export type FigmaFrameDetails = z.infer<typeof FigmaFrameDetails>;

/** A frame and a device screenshot at the same pixel size, and where they differ. */
export const DesignComparison = z.object({
  /** 0–1: share of pixels that differ noticeably. */
  differingFraction: z.number(),
  width: z.number(),
  height: z.number(),
  /** PNGs, base64. */
  design: z.string(),
  screenshot: z.string(),
  /** Differences in red over a faded screenshot. */
  diff: z.string(),
});
export type DesignComparison = z.infer<typeof DesignComparison>;
