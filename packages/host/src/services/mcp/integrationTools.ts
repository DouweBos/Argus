/**
 * Linear and Figma for agents, through Argus's own sign-in — so an agent never
 * depends on a separately configured MCP server staying signed in. Each set is
 * only advertised while its service is connected.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { figmaApi, figmaDesignContext } from "../integrations/figma/service";
import {
  commentOnLinearIssue,
  linearApi,
  linearIssueContext,
  listLinearIssues,
} from "../integrations/service";

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

function failure(err: unknown) {
  return text(err instanceof Error ? err.message : String(err), true);
}

export function registerIntegrationTools(server: McpServer): void {
  if (linearApi()) {
    registerLinearTools(server);
  }
  if (figmaApi()) {
    registerFigmaTools(server);
  }
}

function registerFigmaTools(server: McpServer): void {
  server.tool(
    "figma_get_frame",
    "Get a Figma frame to build or check UI against: the rendered image, its layer tree trimmed to layout, sizes, colors and text, and open designer comments on it. Compare a simulator screenshot to the image before calling UI work done.",
    {
      url: z
        .string()
        .describe(
          "A figma.com design link, ideally with ?node-id= for one frame.",
        ),
    },
    async ({ url }) => {
      try {
        const design = await figmaDesignContext(url);
        if (!design) {
          return text(`"${url}" isn't a Figma frame Argus can read.`, true);
        }
        const notes = design.comments.map((c) => `- ${c.author}: ${c.body}`);

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `# ${design.frame.name} (${design.frame.width}×${design.frame.height} pt)`,
                ...(notes.length > 0
                  ? ["", "## Designer comments", ...notes]
                  : []),
                "",
                "## Layers",
                JSON.stringify(design.node, null, 1),
              ].join("\n"),
            },
            {
              type: "image" as const,
              data: design.frame.image,
              mimeType: "image/png",
            },
          ],
        };
      } catch (err) {
        return failure(err);
      }
    },
  );
}

function registerLinearTools(server: McpServer): void {
  server.tool(
    "linear_get_issue",
    "Read a Linear issue in full: description, state, labels, comments, and the screenshots attached to it. Accepts an identifier (ENG-123) or an issue URL.",
    {
      ref: z
        .string()
        .describe("Issue identifier like ENG-123, or its linear.app URL."),
    },
    async ({ ref }) => {
      try {
        const result = await linearIssueContext(ref);
        if (!result) {
          return text(`No Linear issue found for "${ref}".`, true);
        }

        return {
          content: [
            { type: "text" as const, text: result.context },
            ...result.images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: image.media_type,
            })),
          ],
        };
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.tool(
    "linear_search_issues",
    "Search Linear issues. Without a query, lists the open issues assigned to the connected user, most recently updated first.",
    {
      query: z
        .string()
        .optional()
        .describe("Free-text search. Omit for your assigned issues."),
      limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
    },
    async ({ query, limit }) => {
      try {
        const issues = await listLinearIssues(query ?? null, limit ?? 20);
        const rows = issues.map((i) => ({
          identifier: i.identifier,
          title: i.title,
          state: i.state.name,
          priority: i.priority,
          assignee: i.assignee,
          labels: i.labels,
          url: i.url,
        }));

        return text(
          rows.length > 0 ? JSON.stringify(rows, null, 2) : "No issues found.",
        );
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.tool(
    "linear_comment",
    "Post a comment on a Linear issue as the connected user. Markdown is supported. Use it for progress or questions the issue's people need to see — not for routine chatter.",
    {
      ref: z
        .string()
        .describe("Issue identifier like ENG-123, or its linear.app URL."),
      body: z.string().min(1).describe("Comment body in Markdown."),
    },
    async ({ ref, body }) => {
      try {
        const issue = await commentOnLinearIssue(ref, body);

        return text(`Commented on ${issue.identifier}.`);
      } catch (err) {
        return failure(err);
      }
    },
  );
}
