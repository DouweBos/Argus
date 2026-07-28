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

/**
 * Rewrite GFM task-list `<input type="checkbox">` nodes as
 * `<span data-task-check="checked|unchecked">` _before_ DOMPurify runs.
 *
 * Why not a DOMPurify hook? DOMPurify strips `<input>` in its element
 * pre-pass (DOM-clobbering protection) before any `afterSanitizeAttributes`
 * hook fires, and `ADD_TAGS: ["input"]` alone doesn't keep them either —
 * the tag is dropped and the hook never sees the node. Doing the rewrite
 * up front means the sanitiser never sees an input at all; only the
 * sanitiser-friendly span reaches the output.
 *
 * Both `marked` and GitHub's `bodyHTML` emit the same shape, so a single
 * pre-process covers every markdown surface in the app.
 */
function transformTaskChecks(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html;
  }
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}`,
    "text/html",
  );
  const inputs = doc.querySelectorAll('input[type="checkbox"]');
  if (inputs.length === 0) {
    return html;
  }
  for (const input of Array.from(inputs)) {
    const span = doc.createElement("span");
    span.setAttribute(
      "data-task-check",
      input.hasAttribute("checked") ? "checked" : "unchecked",
    );
    input.replaceWith(span);
  }

  return doc.body.innerHTML;
}

const SANITIZE_CONFIG: DOMPurifyConfig = {
  RETURN_TRUSTED_TYPE: false,
  // Strip the most dangerous elements outright.
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
  // Drop every event handler attribute and any srcdoc/formaction sinks.
  FORBID_ATTR: ["srcdoc", "formaction"],
  // Only allow safe URI schemes; this kills javascript:/data:text/html
  // payloads even when wrapped in <a href> or <img src>.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|argus-file|file):|[#/])/i,
};

/** Parse markdown text to a sanitized HTML string (synchronous). */
export function renderMarkdown(text: string): string {
  const rawHtml = marked.parse(text, { async: false }) as string;
  const withChecks = transformTaskChecks(rawHtml);
  const safeHtml = DOMPurify.sanitize(
    withChecks,
    SANITIZE_CONFIG,
  ) as unknown as string;

  return linkifyFilePaths(safeHtml);
}

/**
 * Sanitise already-rendered HTML (e.g. GitHub's `bodyHTML` from the GraphQL
 * API, which has autolinks, task lists, issue refs, and emoji expanded).
 * Runs through the same DOMPurify config as `renderMarkdown` so XSS is
 * neutralised even when the upstream source is trusted.
 */
export function renderHtml(html: string): string {
  const withChecks = transformTaskChecks(html);
  const safeHtml = DOMPurify.sanitize(
    withChecks,
    SANITIZE_CONFIG,
  ) as unknown as string;

  return linkifyFilePaths(safeHtml);
}
