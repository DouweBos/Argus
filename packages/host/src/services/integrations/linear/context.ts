/**
 * The text an agent gets for an issue. Built on the host so every client
 * starts agents from the same context.
 */

import type { LinearIssueDetail } from "@argus/remote-protocol";

const MARKDOWN_IMAGE =
  /!\[[^\]]*\]\((https:\/\/uploads\.linear\.app\/[^)\s]+)\)/g;
const MAX_COMMENTS = 20;

/** Linear-hosted images in the issue body and comments, in reading order, deduped. */
export function issueImageUrls(issue: LinearIssueDetail): string[] {
  const texts = [issue.description, ...issue.comments.map((c) => c.body)];
  const urls = texts.flatMap((t) =>
    [...t.matchAll(MARKDOWN_IMAGE)].map((m) => m[1]),
  );

  return [...new Set(urls)];
}

const FIGMA_LINK =
  /https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[^\s)>\]]+/g;

/** figma.com links in the issue body and comments, deduped. */
export function issueDesignUrls(issue: LinearIssueDetail): string[] {
  const texts = [issue.description, ...issue.comments.map((c) => c.body)];

  return [...new Set(texts.flatMap((t) => t.match(FIGMA_LINK) ?? []))];
}

export function issueContext(issue: LinearIssueDetail): string {
  const lines = [
    `## Linear issue ${issue.identifier}: ${issue.title}`,
    "",
    `${issue.url} · ${issue.state.name}${issue.labels.length > 0 ? ` · ${issue.labels.join(", ")}` : ""}`,
    "",
    issue.description.trim() || "_No description._",
  ];
  const comments = issue.comments.slice(-MAX_COMMENTS);
  if (comments.length > 0) {
    lines.push("", "### Comments");
    for (const c of comments) {
      lines.push("", `**${c.author ?? "Someone"}:** ${c.body.trim()}`);
    }
  }

  return lines.join("\n");
}
