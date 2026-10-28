/**
 * The only place the host touches `@linear/sdk`. Every call is one hand-written
 * GraphQL document through the SDK's client: its models lazy-load relations, so
 * a page of issues would cost a request per state, team and assignee.
 */

import type {
  IntegrationAccount,
  LinearIssue,
  LinearIssueDetail,
} from "@argus/remote-protocol";
import {
  AuthenticationLinearError,
  LinearClient,
  parseLinearError,
} from "@linear/sdk";

const ISSUE_FIELDS = `
  id identifier title description url branchName priority updatedAt
  state { name type }
  team { key }
  assignee { displayName }
  labels { nodes { name } }
`;

const MY_ISSUES = `query ArgusMyIssues($first: Int!) {
  viewer {
    assignedIssues(
      first: $first
      orderBy: updatedAt
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) { nodes { ${ISSUE_FIELDS} } }
  }
}`;

const SEARCH_ISSUES = `query ArgusSearchIssues($term: String!, $first: Int!) {
  searchIssues(term: $term, first: $first) { nodes { ${ISSUE_FIELDS} } }
}`;

const ISSUE_DETAIL = `query ArgusIssue($id: String!) {
  issue(id: $id) {
    ${ISSUE_FIELDS}
    comments(first: 50) { nodes { body createdAt user { displayName } } }
  }
}`;

const ISSUE_FOR_BRANCH = `query ArgusIssueForBranch($branch: String!) {
  issueVcsBranchSearch(branchName: $branch) { ${ISSUE_FIELDS} }
}`;

const START_STATE = `query ArgusStartState($id: String!) {
  issue(id: $id) {
    state { type }
    team { states(filter: { type: { eq: "started" } }) { nodes { id position } } }
  }
}`;

const SET_STATE = `mutation ArgusSetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`;

const COMMENT = `mutation ArgusComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success }
}`;

const FILE_UPLOAD = `mutation ArgusFileUpload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`;

const TEAMS = `query ArgusTeams {
  teams(first: 100) { nodes { id key name } }
}`;

const CREATE_ISSUE = `mutation ArgusCreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } }
}`;

const VIEWER_ID = `query ArgusViewerId { viewer { id } }`;

const VIEWER = `query ArgusViewer {
  viewer { displayName email }
  organization { name }
}`;

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  branchName: string;
  priority: number;
  updatedAt: string;
  state: { name: string; type: string };
  team: { key: string };
  assignee?: { displayName: string } | null;
  labels: { nodes: { name: string }[] };
}

interface RawComment {
  body: string;
  createdAt: string;
  user?: { displayName: string } | null;
}

export function toLinearIssue(raw: RawIssue): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? "",
    url: raw.url,
    branchName: raw.branchName,
    state: { name: raw.state.name, type: raw.state.type },
    priority: raw.priority,
    teamKey: raw.team.key,
    assignee: raw.assignee?.displayName ?? null,
    labels: raw.labels.nodes.map((l) => l.name),
    updatedAt: Date.parse(raw.updatedAt),
  };
}

/** The credential was rejected — the caller flags the integration for reauth. */
export class LinearAuthError extends Error {}

export interface LinearCredential {
  method: "key" | "oauth";
  secret: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class LinearApi {
  private readonly sdk: LinearClient;

  constructor(private readonly credential: LinearCredential) {
    this.sdk = new LinearClient(
      credential.method === "key"
        ? { apiKey: credential.secret }
        : { accessToken: credential.secret },
    );
  }

  private async query<T>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      return await this.sdk.client.request<T, Record<string, unknown>>(
        document,
        variables,
      );
    } catch (raw) {
      // The SDK only wraps errors for its own model calls, not raw requests.
      const err = parseLinearError(
        raw as Parameters<typeof parseLinearError>[0],
      );
      if (err instanceof AuthenticationLinearError) {
        throw new LinearAuthError(err.message);
      }
      throw new Error(`Linear: ${err.message}`);
    }
  }

  async account(): Promise<IntegrationAccount> {
    const data = await this.query<{
      viewer: { displayName: string; email: string | null };
      organization: { name: string } | null;
    }>(VIEWER);

    return {
      name: data.viewer.displayName,
      email: data.viewer.email,
      workspace: data.organization?.name ?? null,
    };
  }

  async myIssues(limit: number): Promise<LinearIssue[]> {
    const data = await this.query<{
      viewer: { assignedIssues: { nodes: RawIssue[] } };
    }>(MY_ISSUES, { first: limit });

    return data.viewer.assignedIssues.nodes.map(toLinearIssue);
  }

  async searchIssues(term: string, limit: number): Promise<LinearIssue[]> {
    const data = await this.query<{ searchIssues: { nodes: RawIssue[] } }>(
      SEARCH_ISSUES,
      { term, first: limit },
    );

    return data.searchIssues.nodes.map(toLinearIssue);
  }

  async issue(identifier: string): Promise<LinearIssueDetail | null> {
    try {
      const data = await this.query<{
        issue: (RawIssue & { comments: { nodes: RawComment[] } }) | null;
      }>(ISSUE_DETAIL, { id: identifier });
      if (!data.issue) {
        return null;
      }

      return {
        ...toLinearIssue(data.issue),
        comments: data.issue.comments.nodes
          .map((c) => ({
            author: c.user?.displayName ?? null,
            body: c.body,
            createdAt: Date.parse(c.createdAt),
          }))
          .sort((a, b) => a.createdAt - b.createdAt),
      };
    } catch (err) {
      // Linear answers an unknown identifier with an "entity not found" error.
      if (err instanceof Error && /not found/i.test(err.message)) {
        return null;
      }
      throw err;
    }
  }

  async issueForBranch(branch: string): Promise<LinearIssue | null> {
    const data = await this.query<{ issueVcsBranchSearch: RawIssue | null }>(
      ISSUE_FOR_BRANCH,
      { branch },
    );

    return data.issueVcsBranchSearch
      ? toLinearIssue(data.issueVcsBranchSearch)
      : null;
  }

  /** Moves the issue to its team's first "started" state, unless it's already past backlog. */
  async markStarted(issueId: string): Promise<boolean> {
    const data = await this.query<{
      issue: {
        state: { type: string };
        team: { states: { nodes: { id: string; position: number }[] } };
      } | null;
    }>(START_STATE, { id: issueId });
    if (
      !data.issue ||
      !["backlog", "unstarted", "triage"].includes(data.issue.state.type)
    ) {
      return false;
    }
    const [first] = [...data.issue.team.states.nodes].sort(
      (a, b) => a.position - b.position,
    );
    if (!first) {
      return false;
    }
    await this.query(SET_STATE, { id: issueId, stateId: first.id });

    return true;
  }

  /** An `uploads.linear.app` image, or null when it isn't one an agent can take. */
  async image(
    url: string,
  ): Promise<{ data: string; media_type: string } | null> {
    const res = await fetch(url, {
      headers: {
        authorization:
          this.credential.method === "key"
            ? this.credential.secret
            : `Bearer ${this.credential.secret}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !IMAGE_TYPES.has(type)) {
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      return null;
    }

    return { data: bytes.toString("base64"), media_type: type };
  }

  /** Uploads to Linear's storage and returns the URL to embed in Markdown. */
  async upload(png: Buffer, filename: string): Promise<string> {
    const data = await this.query<{
      fileUpload: {
        uploadFile: {
          uploadUrl: string;
          assetUrl: string;
          headers: { key: string; value: string }[];
        } | null;
      };
    }>(FILE_UPLOAD, { contentType: "image/png", filename, size: png.length });
    const file = data.fileUpload.uploadFile;
    if (!file) {
      throw new Error("Linear didn't accept the upload.");
    }
    const res = await fetch(file.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000",
        ...Object.fromEntries(file.headers.map((h) => [h.key, h.value])),
      },
      body: new Uint8Array(png),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Linear upload failed with HTTP ${res.status}.`);
    }

    return file.assetUrl;
  }

  async teams(): Promise<{ id: string; key: string; name: string }[]> {
    const data = await this.query<{
      teams: { nodes: { id: string; key: string; name: string }[] };
    }>(TEAMS);

    return data.teams.nodes;
  }

  /** Created assigned to the connected user, so it shows up in their picker. */
  async createIssue(input: {
    teamId: string;
    title: string;
    description: string;
  }): Promise<LinearIssue> {
    const viewer = await this.query<{ viewer: { id: string } }>(VIEWER_ID);
    const data = await this.query<{ issueCreate: { issue: RawIssue | null } }>(
      CREATE_ISSUE,
      { input: { ...input, assigneeId: viewer.viewer.id } },
    );
    if (!data.issueCreate.issue) {
      throw new Error("Linear didn't create the issue.");
    }

    return toLinearIssue(data.issueCreate.issue);
  }

  async comment(issueId: string, body: string): Promise<void> {
    await this.query(COMMENT, { issueId, body });
  }
}
