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

const ISSUE_FIELDS = `
  id identifier title description url branchName priority estimate createdAt updatedAt
  state { id name type position }
  team { id key name }
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
    comments(first: 100) { nodes { body createdAt user { displayName } } }
    attachments(first: 25) { nodes { title subtitle url sourceType } }
    children(first: 50) { nodes { identifier title state { name type } } }
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

export const COMMENT = `mutation ArgusComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success }
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
  team: { id: string; key: string; name: string };
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

export interface RawIssueDetail extends Omit<RawIssue, "attachments"> {
  comments: {
    nodes: {
      body: string;
      createdAt: string;
      user?: { displayName: string } | null;
    }[];
  };
  attachments: {
    nodes: {
      title: string;
      subtitle?: string | null;
      url: string;
      sourceType?: string | null;
    }[];
  };
  children: {
    nodes: {
      identifier: string;
      title: string;
      state: { name: string; type: string };
    }[];
  };
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

export function toLinearIssueDetail(raw: RawIssueDetail): LinearIssueDetail {
  return {
    ...toLinearIssue(raw),
    comments: raw.comments.nodes
      .map((c) => ({
        author: c.user?.displayName ?? null,
        body: c.body,
        createdAt: Date.parse(c.createdAt),
      }))
      .sort((a, b) => a.createdAt - b.createdAt),
    attachments: raw.attachments.nodes.map((a) => ({
      title: a.title,
      subtitle: a.subtitle ?? null,
      url: a.url,
      sourceType: a.sourceType ?? null,
    })),
    children: raw.children.nodes.map((c) => ({
      identifier: c.identifier,
      title: c.title,
      state: { name: c.state.name, type: c.state.type },
    })),
  };
}
