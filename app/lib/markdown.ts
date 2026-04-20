import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
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

// `marked` (v5+) no longer ships a built-in sanitizer — raw HTML inside the
// markdown is passed through unchanged. Every place we feed renderMarkdown's
// output to dangerouslySetInnerHTML is therefore an XSS sink unless we
// sanitize. Markdown sources (agent output, tool results, file contents
// quoted into chat, MCP-writable system prompts) are all untrusted, so we
// must scrub script/iframe/form/event-handler/javascript: vectors here.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof HTMLAnchorElement) {
    // Force every link to open externally with no opener — defense in depth
    // even after javascript: URIs are stripped by ALLOWED_URI_REGEXP.
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const SANITIZE_CONFIG: DOMPurifyConfig = {
  RETURN_TRUSTED_TYPE: false,
  // Strip the most dangerous elements outright.
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
  // Drop every event handler attribute and any srcdoc/formaction sinks.
  FORBID_ATTR: ["srcdoc", "formaction"],
  // Only allow safe URI schemes; this kills javascript:/data:text/html
  // payloads even when wrapped in <a href> or <img src>.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|argus-file|argus-ext|extension-file|file|vscode):|[#/])/i,
};

/** Parse markdown text to a sanitized HTML string (synchronous). */
export function renderMarkdown(text: string): string {
  const rawHtml = marked.parse(text, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(
    rawHtml,
    SANITIZE_CONFIG,
  ) as unknown as string;

  return linkifyFilePaths(safeHtml);
}
