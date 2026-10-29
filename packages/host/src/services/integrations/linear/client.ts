/**
 * The only place the host touches `@linear/sdk`, used as a GraphQL transport
 * with typed errors; the documents and mapping live in `queries.ts`.
 */

import type {
  IntegrationAccount,
  LinearIssue,
  LinearIssueDetail,
  LinearIssueScope,
  LinearWorkflowState,
} from "@argus/remote-protocol";
import {
  AuthenticationLinearError,
  LinearClient,
  parseLinearError,
} from "@linear/sdk";
import {
  COMMENT,
  CREATE_ISSUE,
  FILE_UPLOAD,
  ISSUE_DETAIL,
  ISSUE_FOR_BRANCH,
  type RawIssue,
  type RawIssueDetail,
  SCOPED_ISSUES,
  SEARCH_ISSUES,
  START_STATE,
  TEAM_STATES,
  TEAMS,
  toLinearIssue,
  toLinearIssueDetail,
  UPDATE_ISSUE,
  VIEWER,
  VIEWER_ID,
} from "./queries";

export { toLinearIssue } from "./queries";

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
    return this.scopedIssues("assigned", limit);
  }

  async scopedIssues(
    scope: LinearIssueScope,
    limit: number,
  ): Promise<LinearIssue[]> {
    const data = await this.query<{
      viewer?: {
        assignedIssues?: { nodes: RawIssue[] };
        createdIssues?: { nodes: RawIssue[] };
      };
      issues?: { nodes: RawIssue[] };
    }>(SCOPED_ISSUES[scope], { first: limit });
    const nodes =
      data.viewer?.assignedIssues?.nodes ??
      data.viewer?.createdIssues?.nodes ??
      data.issues?.nodes ??
      [];

    return nodes.map(toLinearIssue);
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
      const data = await this.query<{ issue: RawIssueDetail | null }>(
        ISSUE_DETAIL,
        { id: identifier },
      );

      return data.issue ? toLinearIssueDetail(data.issue) : null;
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
        id: string;
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
    // `issueId` may be an identifier; the update takes the issue's own id.
    await this.updateIssue(data.issue.id, { stateId: first.id });

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

  async teamStates(teamId: string): Promise<LinearWorkflowState[]> {
    const data = await this.query<{
      team: { states: { nodes: LinearWorkflowState[] } } | null;
    }>(TEAM_STATES, { teamId });

    return [...(data.team?.states.nodes ?? [])].sort(
      (a, b) => a.position - b.position,
    );
  }

  async updateIssue(
    issueId: string,
    input: { priority?: number; stateId?: string },
  ): Promise<LinearIssue> {
    const data = await this.query<{
      issueUpdate: { issue: RawIssue | null };
    }>(UPDATE_ISSUE, { id: issueId, input });
    if (!data.issueUpdate.issue) {
      throw new Error("Linear didn't update the issue.");
    }

    return toLinearIssue(data.issueUpdate.issue);
  }

  async comment(
    issueId: string,
    body: string,
    parentId: string | null = null,
  ): Promise<void> {
    await this.query(COMMENT, { issueId, body, parentId });
  }
}
