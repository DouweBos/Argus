/**
 * `github_get` and `search_github_artifact`: GitHub reads for automation runs.
 *
 * A read-only run may not call `gh api` or `gh run download` from the shell,
 * because a write through either is only a flag away. These fix the method and
 * own the scratch dir, so reading CI logs and artifacts needs no shell parsing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { githubGet, searchGithubArtifact } from "../github/readOnly";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { automationRunForAgent } from "./automationCaller";

const DEFAULT_MAX_LINES = 200;

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function failure(e: unknown): string {
  return typeof e === "string" ? e : String(e);
}

export function registerAutomationGithubTools(
  server: McpServer,
  callerAgentId: string | null,
): void {
  const run = async (
    tool: "artifact_search" | "get",
    work: () => Promise<string>,
  ) => {
    if (!automationRunForAgent(callerAgentId)) {
      return textResult("Only available to automation runs.", true);
    }
    try {
      const text = await work();
      telemetryCapture("automation_github_read", { tool, success: true });

      return textResult(text);
    } catch (e) {
      telemetryCapture("automation_github_read", { tool, success: false });

      return textResult(failure(e), true);
    }
  };

  server.tool(
    "github_get",
    "GET one GitHub REST API path through the host's `gh` login — workflow runs, jobs, job logs (`repos/{owner}/{repo}/actions/jobs/{id}/logs`), artifact lists, issues, PRs. Read-only: the method is always GET. Use `jq` to shape JSON and `pattern` to keep only matching lines of a long log.",
    {
      path: z
        .string()
        .describe(
          "REST path without the host, e.g. 'repos/plexinc/app/actions/runs/123/jobs'. Query strings are fine.",
        ),
      jq: z
        .string()
        .optional()
        .describe(
          "A jq filter applied to the JSON response, as `gh api --jq`.",
        ),
      paginate: z
        .boolean()
        .optional()
        .describe("Follow every page of a list endpoint."),
      pattern: z
        .string()
        .optional()
        .describe(
          "Case-insensitive regex; only lines matching it are returned. Use it on job logs.",
        ),
      max_lines: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          `Cap on matching lines returned. Default ${DEFAULT_MAX_LINES}.`,
        ),
    },
    ({ path, jq, paginate, pattern, max_lines }) =>
      run("get", () =>
        githubGet({
          path,
          jq,
          paginate,
          pattern,
          maxLines: max_lines ?? DEFAULT_MAX_LINES,
        }),
      ),
  );

  server.tool(
    "search_github_artifact",
    "Search inside one workflow run artifact — device logs, test reports — without writing anything yourself. The host downloads it to a scratch dir, greps every text file, returns `file:line: text` for each match, and deletes it. Find artifact names with `github_get` on `repos/{owner}/{repo}/actions/runs/{id}/artifacts`.",
    {
      repo: z
        .string()
        .describe("owner/name, e.g. 'plexinc/react-native-client'."),
      run_id: z.string().describe("The workflow run id."),
      artifact: z
        .string()
        .describe("The artifact's name, as listed for the run."),
      pattern: z.string().describe("Case-insensitive regex to search for."),
      max_lines: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          `Cap on matching lines returned. Default ${DEFAULT_MAX_LINES}.`,
        ),
    },
    ({ repo, run_id, artifact, pattern, max_lines }) =>
      run("artifact_search", () =>
        searchGithubArtifact({
          repo,
          runId: run_id,
          artifact,
          pattern,
          maxLines: max_lines ?? DEFAULT_MAX_LINES,
        }),
      ),
  );
}
