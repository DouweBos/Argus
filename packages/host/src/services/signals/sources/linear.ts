/**
 * Linear as an agent-mode source — a paragraph, not a project.
 *
 * There is no Linear client here and no new auth: the Linear MCP server is
 * already merged into every agent's tool set by `mcp/userConfig.ts`, so the
 * source's whole contribution is prompt text telling the run's agent which
 * tools to call and what shape to normalize the answers into. Availability is
 * the same question asked of config rather than of a network: is a Linear MCP
 * server going to be on the agent's tool list at all?
 */

import type { SignalSource } from "../types";
import { loadAppMcpServers } from "../../appSettings/store";
import { listInheritedMcpServers } from "../../mcp/userConfig";

export const LINEAR_SOURCE_ID = "linear";

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

export const linearSource: SignalSource = {
  id: LINEAR_SOURCE_ID,
  label: "Linear",
  mode: "agent",

  isAvailable() {
    const names = [
      ...listInheritedMcpServers().map((s) => s.name),
      ...Object.keys(loadAppMcpServers()),
    ];

    return Promise.resolve(names.some(isLinearServer));
  },

  agentInstructions: linearInstructions,
};
