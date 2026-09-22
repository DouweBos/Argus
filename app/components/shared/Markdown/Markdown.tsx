import type { Element, ElementContent, Root, Text } from "hast";
import { SKIP, visit } from "unist-util-visit";
import { Markdown as PeacockMarkdown } from "@argus/peacock";
import { splitTextForLinks } from "../../../lib/filePathLink";
import { MermaidChart } from "../../agent/MermaidChart/MermaidChart";

// Walks hast text nodes and splits file-path / URL substrings into anchor
// elements. Skips text already inside an <a>. Injected into the Peacock
// Markdown renderer as an extra rehype plugin (desktop-only behavior).
function rehypeFileLinks() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined) {
        return;
      }
      if (parent.type === "element" && (parent as Element).tagName === "a") {
        return;
      }
      const segments = splitTextForLinks(node.value);
      if (segments.length === 1 && segments[0].type === "text") {
        return;
      }
      const replacements: ElementContent[] = segments.map((seg) => {
        if (seg.type === "text") {
          return { type: "text", value: seg.value };
        }
        if (seg.type === "url") {
          return {
            type: "element",
            tagName: "a",
            properties: {
              className: ["external-link"],
              href: seg.url,
              "data-external-url": seg.url,
            },
            children: [{ type: "text", value: seg.label }],
          };
        }

        return {
          type: "element",
          tagName: "a",
          properties: {
            className: ["file-link"],
            "data-file-path": seg.path,
            ...(seg.line != null ? { "data-file-line": seg.line } : {}),
          },
          children: [{ type: "text", value: seg.label }],
        };
      });
      (parent as Element).children.splice(index, 1, ...replacements);

      return [SKIP, index + replacements.length];
    });
  };
}

interface MarkdownProps {
  /** Opt into Peacock's prose stylesheet instead of the caller's own. */
  baseProse?: boolean;
  className?: string;
  text: string;
}

// Stable identities: passing fresh array/function props every render would
// churn Peacock's memoized `components`, remounting inline mermaid diagrams.
const REHYPE_PLUGINS = [rehypeFileLinks];
const renderMermaid = (code: string) => <MermaidChart code={code} />;

/**
 * Desktop markdown: the shared Peacock renderer with file-path linkification
 * and inline mermaid injected. Callers keep supplying their own prose
 * `className`, so base prose is disabled to avoid double-styling.
 */
export function Markdown({
  baseProse = false,
  className,
  text,
}: MarkdownProps) {
  return (
    <PeacockMarkdown
      baseProse={baseProse}
      className={className}
      rehypePlugins={REHYPE_PLUGINS}
      renderMermaid={renderMermaid}
      text={text}
    />
  );
}
