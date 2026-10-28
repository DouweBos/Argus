/**
 * Linear as a signal source. With Linear connected in Settings → Integrations
 * it's native: Argus fetches the assigned issues itself, so a run spends no
 * tokens on it and doesn't fail when an MCP sign-in lapses. Without it, it
 * falls back to a paragraph telling the run's agent to fetch through a Linear
 * MCP server merged in by `mcp/userConfig.ts`.
 */

import type { SignalSource, WorkItem } from "../types";
import type { LinearIssue } from "@argus/remote-protocol";
import { loadAppMcpServers } from "../../appSettings/store";
import { freshLinearApi, linearApi } from "../../integrations/service";
import { listInheritedMcpServers } from "../../mcp/userConfig";
import { LINEAR_SOURCE_ID } from "../sourceIds";

/** A server counts as Linear if its name says so — the config is opaque JSON. */
function isLinearServer(name: string): boolean {
  return name.toLowerCase().includes("linear");
}

/**
 * The paragraph. It names tools rather than endpoints because the agent, not
 * Argus, does the fetching — and it spells out the `WorkItem` shape so items
 * from Linear rank alongside the ones Node fetched instead of in a list of
 * their own.
 */
function linearInstructions(): string {
  return [
    "### Linear",
    "",
    "Linear work was **not** fetched for you. Fetch it yourself with the Linear MCP tools on your tool list — `list_my_issues` if it is there, otherwise the closest equivalent (`list_issues` filtered to yourself, assigned and not done). Ask for at most 50.",
    "",
    "Normalize every issue you get back into the same shape as the work items above before you reason about it:",
    "",
    "```json",
    JSON.stringify(
      {
        source_id: LINEAR_SOURCE_ID,
        external_id: "ENG-123",
        url: "https://linear.app/…/issue/ENG-123",
        title: "Issue title",
        body: "Issue description, or an empty string",
        state: "In Progress",
        assignee: "Linear display name, or null",
        labels: ["label names"],
        priority: 2,
        updated_at: 0,
        kind: "task",
        repo_root: null,
      },
      null,
      2,
    ),
    "```",
    "",
    "`priority` is Linear's own 0–4, where 1 is urgent — do not rescale it. `updated_at` is epoch milliseconds. Set `repo_root` to the absolute path of the project in scope the issue belongs to when the issue or its team makes that obvious, and leave it `null` when it does not — a guessed repo turns into work in the wrong checkout.",
    "",
    "Then rank and act on the Linear issues together with the items above, as one list. If the Linear tools are missing or every call fails, say so in one line of the report and carry on with what you do have; do not invent issues.",
  ].join("\n");
}

const ASSIGNED_LIMIT = 50;

export function issueToWorkItem(issue: LinearIssue): WorkItem {
  return {
    source_id: LINEAR_SOURCE_ID,
    external_id: issue.identifier,
    url: issue.url,
    title: issue.title,
    body: issue.description,
    state: issue.state.name,
    assignee: issue.assignee,
    labels: issue.labels,
    priority: issue.priority,
    updated_at: issue.updatedAt,
    kind: "task",
    // Linear teams don't map to checkouts; the run decides from the content.
    repo_root: null,
  };
}

function hasLinearMcpServer(): boolean {
  const names = [
    ...listInheritedMcpServers().map((s) => s.name),
    ...Object.keys(loadAppMcpServers()),
  ];

  return names.some(isLinearServer);
}

export const linearSource: SignalSource = {
  id: LINEAR_SOURCE_ID,
  label: "Linear",

  get mode() {
    return linearApi() ? "native" : "agent";
  },

  isAvailable() {
    return Promise.resolve(Boolean(linearApi()) || hasLinearMcpServer());
  },

  async fetchAssigned() {
    const api = await freshLinearApi();

    return api ? (await api.myIssues(ASSIGNED_LIMIT)).map(issueToWorkItem) : [];
  },

  agentInstructions: linearInstructions,
};

export { LINEAR_SOURCE_ID };
