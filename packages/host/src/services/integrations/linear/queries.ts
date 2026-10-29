/**
 * The GraphQL documents the Linear client sends, and the mapping from Linear's
 * shapes to Argus's. One document per call: the SDK's models would lazy-load
 * every relation with a request of its own.
 */

import type {
  LinearIssue,
  LinearIssueDetail,
  LinearIssueScope,
  LinearWorkflowState,
} from "@argus/remote-protocol";
import { historyEvents } from "./history";

const ISSUE_FIELDS = `
  id identifier title description url branchName priority estimate createdAt updatedAt
  state { id name type position }
  team { id key name issueEstimationType }
  assignee { displayName avatarUrl }
  creator { displayName }
  dueDate
  labels { nodes { name } }
  project { id name }
  cycle { id number name isActive }
  parent { identifier title }
  attachments(first: 25) { nodes { url sourceType } }
`;

const OPEN = `filter: { state: { type: { nin: ["completed", "canceled"] } } }`;

export const SCOPED_ISSUES: Record<LinearIssueScope, string> = {
  assigned: `query ArgusAssigned($first: Int!) {
    viewer { assignedIssues(first: $first, orderBy: updatedAt, ${OPEN}) { nodes { ${ISSUE_FIELDS} } } }
  }`,
  created: `query ArgusCreated($first: Int!) {
    viewer { createdIssues(first: $first, orderBy: updatedAt, ${OPEN}) { nodes { ${ISSUE_FIELDS} } } }
  }`,
  subscribed: `query ArgusSubscribed($first: Int!) {
    issues(
      first: $first
      orderBy: updatedAt
      filter: {
        subscribers: { isMe: { eq: true } }
        state: { type: { nin: ["completed", "canceled"] } }
      }
    ) { nodes { ${ISSUE_FIELDS} } }
  }`,
};

export const SEARCH_ISSUES = `query ArgusSearchIssues($term: String!, $first: Int!) {
  searchIssues(term: $term, first: $first) { nodes { ${ISSUE_FIELDS} } }
}`;

export const ISSUE_DETAIL = `query ArgusIssue($id: String!) {
  issue(id: $id) {
    ${ISSUE_FIELDS}
    labels { nodes { name color } }
    comments(first: 100) {
      nodes {
        id body createdAt
        parent { id }
        user { displayName avatarUrl }
        reactions { emoji }
      }
    }
    attachments(first: 25) { nodes { title subtitle url sourceType createdAt } }
    children(first: 50) { nodes { identifier title state { name type } } }
    subscribers(first: 25) { nodes { displayName avatarUrl } }
    relations(first: 25) { nodes { type relatedIssue { identifier title state { name type } } } }
    inverseRelations(first: 25) { nodes { type issue { identifier title state { name type } } } }
    creator { displayName avatarUrl }
    history(first: 100) {
      nodes {
        id createdAt updatedDescription fromPriority toPriority fromEstimate toEstimate
        fromTitle toTitle fromDueDate toDueDate
        actor { displayName avatarUrl }
        fromState { name type } toState { name type }
        fromAssignee { displayName } toAssignee { displayName }
        fromCycle { number name } toCycle { number name }
        fromProject { name } toProject { name }
        fromParent { identifier } toParent { identifier }
        addedLabels { name } removedLabels { name }
        attachment { title }
        relationChanges { identifier type }
      }
    }
  }
}`;

export const ISSUE_FOR_BRANCH = `query ArgusIssueForBranch($branch: String!) {
  issueVcsBranchSearch(branchName: $branch) { ${ISSUE_FIELDS} }
}`;

export const START_STATE = `query ArgusStartState($id: String!) {
  issue(id: $id) {
    id
    state { type }
    team { states(filter: { type: { eq: "started" } }) { nodes { id position } } }
  }
}`;

export const TEAM_STATES = `query ArgusTeamStates($teamId: String!) {
  team(id: $teamId) { states(first: 50) { nodes { id name type position } } }
}`;

export const UPDATE_ISSUE = `mutation ArgusUpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { issue { ${ISSUE_FIELDS} } }
}`;

export const COMMENT = `mutation ArgusComment($issueId: String!, $body: String!, $parentId: String) {
  commentCreate(input: { issueId: $issueId, body: $body, parentId: $parentId }) { success }
}`;

export const FILE_UPLOAD = `mutation ArgusFileUpload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`;

export const TEAMS = `query ArgusTeams {
  teams(first: 100) { nodes { id key name } }
}`;

export const CREATE_ISSUE = `mutation ArgusCreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } }
}`;

export const VIEWER_ID = `query ArgusViewerId { viewer { id } }`;

export const VIEWER = `query ArgusViewer {
  viewer { displayName email }
  organization { name }
}`;

export interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  branchName: string;
  priority: number;
  estimate?: number | null;
  createdAt: string;
  updatedAt: string;
  state: LinearWorkflowState;
  team: {
    id: string;
    key: string;
    name: string;
    issueEstimationType?: string | null;
  };
  assignee?: { displayName: string; avatarUrl?: string | null } | null;
  creator?: { displayName: string } | null;
  dueDate?: string | null;
  labels: { nodes: { name: string }[] };
  project?: { id: string; name: string } | null;
  cycle?: {
    id: string;
    number: number;
    name?: string | null;
    isActive: boolean;
  } | null;
  parent?: { identifier: string; title: string } | null;
  attachments: { nodes: { url: string; sourceType?: string | null }[] };
}

interface RawIssueRef {
  identifier: string;
  title: string;
  state: { name: string; type: string };
}

export interface RawHistory {
  id: string;
  createdAt: string;
  updatedDescription?: boolean | null;
  fromPriority?: number | null;
  toPriority?: number | null;
  fromEstimate?: number | null;
  toEstimate?: number | null;
  fromTitle?: string | null;
  toTitle?: string | null;
  fromDueDate?: string | null;
  toDueDate?: string | null;
  actor?: { displayName: string; avatarUrl?: string | null } | null;
  fromState?: { name: string; type?: string } | null;
  toState?: { name: string; type?: string } | null;
  fromAssignee?: { displayName: string } | null;
  toAssignee?: { displayName: string } | null;
  fromCycle?: { number: number; name?: string | null } | null;
  toCycle?: { number: number; name?: string | null } | null;
  fromProject?: { name: string } | null;
  toProject?: { name: string } | null;
  fromParent?: { identifier: string } | null;
  toParent?: { identifier: string } | null;
  addedLabels?: { name: string }[] | null;
  removedLabels?: { name: string }[] | null;
  attachment?: { title: string } | null;
  relationChanges?: { identifier: string; type: string }[] | null;
}

export interface RawIssueDetail extends Omit<
  RawIssue,
  "attachments" | "labels"
> {
  labels: { nodes: { name: string; color?: string | null }[] };
  comments: {
    nodes: {
      id: string;
      body: string;
      createdAt: string;
      parent?: { id: string } | null;
      user?: { displayName: string; avatarUrl?: string | null } | null;
      reactions?: { emoji: string }[] | null;
    }[];
  };
  attachments: {
    nodes: {
      title: string;
      subtitle?: string | null;
      url: string;
      sourceType?: string | null;
      createdAt?: string | null;
    }[];
  };
  children: { nodes: RawIssueRef[] };
  subscribers?: {
    nodes: { displayName: string; avatarUrl?: string | null }[];
  } | null;
  relations?: { nodes: { type: string; relatedIssue: RawIssueRef }[] } | null;
  inverseRelations?: { nodes: { type: string; issue: RawIssueRef }[] } | null;
  creator?: { displayName: string; avatarUrl?: string | null } | null;
  history?: { nodes: RawHistory[] } | null;
}

const PULL_REQUEST = /\/(?:pull|merge_requests)\/\d+/;

export function toLinearIssue(raw: RawIssue | RawIssueDetail): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? "",
    url: raw.url,
    branchName: raw.branchName,
    state: {
      id: raw.state.id,
      name: raw.state.name,
      type: raw.state.type,
      position: raw.state.position,
    },
    priority: raw.priority,
    estimate: raw.estimate ?? null,
    estimateType: raw.team.issueEstimationType ?? null,
    teamId: raw.team.id,
    teamKey: raw.team.key,
    teamName: raw.team.name,
    assignee: raw.assignee?.displayName ?? null,
    assigneeAvatarUrl: raw.assignee?.avatarUrl ?? null,
    creator: raw.creator?.displayName ?? null,
    dueDate: raw.dueDate ?? null,
    labels: raw.labels.nodes.map((l) => l.name),
    project: raw.project
      ? { id: raw.project.id, name: raw.project.name }
      : null,
    cycle: raw.cycle
      ? {
          id: raw.cycle.id,
          number: raw.cycle.number,
          name: raw.cycle.name ?? null,
          isActive: raw.cycle.isActive,
        }
      : null,
    parent: raw.parent
      ? { identifier: raw.parent.identifier, title: raw.parent.title }
      : null,
    pullRequestCount: raw.attachments.nodes.filter((a) =>
      PULL_REQUEST.test(a.url),
    ).length,
    createdAt: Date.parse(raw.createdAt),
    updatedAt: Date.parse(raw.updatedAt),
  };
}

function reactionCounts(
  reactions: { emoji: string }[] | null | undefined,
): { emoji: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of reactions ?? []) {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  }

  return [...counts].map(([emoji, count]) => ({ emoji, count }));
}

/**
 * Every status the issue has been in, oldest first, with when it entered it.
 * The first one starts at creation: the state the first change left, or the
 * current one when it never moved.
 */
function statusHistory(
  raw: RawIssueDetail,
): { name: string; type: string; enteredAt: number }[] {
  const moves = (raw.history?.nodes ?? [])
    .filter((h) => h.toState)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const first = moves[0]?.fromState ?? raw.state;

  return [
    {
      name: first.name,
      type: first.type ?? raw.state.type,
      enteredAt: Date.parse(raw.createdAt),
    },
    ...moves.map((h) => ({
      name: h.toState!.name,
      type: h.toState!.type ?? raw.state.type,
      enteredAt: Date.parse(h.createdAt),
    })),
  ];
}

/** A relation as seen from this issue: "blocks" turns into "blocked_by" from the other side. */
const INVERSE: Record<string, string> = {
  blocks: "blocked_by",
  duplicate: "duplicate_of",
  related: "related",
  similar: "similar",
};

export function toLinearIssueDetail(raw: RawIssueDetail): LinearIssueDetail {
  const ref = (r: RawIssueRef) => ({
    identifier: r.identifier,
    title: r.title,
    state: { name: r.state.name, type: r.state.type },
  });
  const creation = {
    id: `created-${raw.id}`,
    createdAt: Date.parse(raw.createdAt),
    actor: raw.creator?.displayName ?? null,
    actorAvatarUrl: raw.creator?.avatarUrl ?? null,
    kind: "created" as const,
    text: "created the issue",
  };

  return {
    ...toLinearIssue({
      ...raw,
      labels: { nodes: raw.labels.nodes.map((l) => ({ name: l.name })) },
      attachments: { nodes: raw.attachments.nodes },
    }),
    comments: raw.comments.nodes
      .map((c) => ({
        id: c.id,
        parentId: c.parent?.id ?? null,
        author: c.user?.displayName ?? null,
        authorAvatarUrl: c.user?.avatarUrl ?? null,
        reactions: reactionCounts(c.reactions),
        body: c.body,
        createdAt: Date.parse(c.createdAt),
      }))
      .sort((a, b) => a.createdAt - b.createdAt),
    attachments: raw.attachments.nodes.map((a) => ({
      title: a.title,
      subtitle: a.subtitle ?? null,
      url: a.url,
      sourceType: a.sourceType ?? null,
      createdAt: a.createdAt ? Date.parse(a.createdAt) : null,
    })),
    children: raw.children.nodes.map(ref),
    history: [
      creation,
      ...(raw.history?.nodes ?? [])
        .flatMap((h) => historyEvents(h, raw.team.issueEstimationType ?? null))
        .sort((a, b) => a.createdAt - b.createdAt),
    ],
    subscribers: (raw.subscribers?.nodes ?? []).map((u) => ({
      name: u.displayName,
      avatarUrl: u.avatarUrl ?? null,
    })),
    relations: [
      ...(raw.relations?.nodes ?? []).map((r) => ({
        type: r.type,
        ...ref(r.relatedIssue),
      })),
      ...(raw.inverseRelations?.nodes ?? []).map((r) => ({
        type: INVERSE[r.type] ?? r.type,
        ...ref(r.issue),
      })),
    ],
    statusHistory: statusHistory(raw),
    labelColors: raw.labels.nodes.map((l) => ({
      name: l.name,
      color: l.color ?? "#888888",
    })),
  };
}
