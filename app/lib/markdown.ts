import { marked } from "marked";
import { linkifyFilePaths } from "./filePathLink";

/**
 * Configure marked for safe, consistent rendering.
 * gfm: GitHub-Flavored Markdown (tables, fenced code blocks, etc.)
 * breaks: convert single newlines to <br> tags
 */
marked.use({
  breaks: true,
  gfm: true,
});

/** Parse markdown text to an HTML string (synchronous). */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;

  return linkifyFilePaths(html);
}
