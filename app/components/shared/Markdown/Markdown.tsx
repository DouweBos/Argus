import type { Element, ElementContent, Root, Text } from "hast";
import { memo } from "react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { SKIP, visit } from "unist-util-visit";
import { splitTextForLinks } from "../../../lib/filePathLink";

const URI_ALLOW =
  /^(?:(?:https?|mailto|tel|argus-file|argus-ext|extension-file|file|vscode):|[#/])/i;

function urlTransform(url: string): string {
  if (URI_ALLOW.test(url)) {
    return url;
  }

  return defaultUrlTransform(url);
}

// Walks hast text nodes and splits file-path / URL substrings into anchor
// elements, matching the behavior of the previous string-based
// `linkifyFilePaths`. Skips text already inside an <a>.
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

const components: Components = {
  // GFM task-list checkbox → span with data-task-check, matching the
  // global [data-task-check] CSS so every markdown surface renders checkboxes
  // identically.
  input: ({ type, checked, ...rest }) => {
    if (type === "checkbox") {
      return (
        <span data-task-check={checked ? "checked" : "unchecked"} {...rest} />
      );
    }

    return <input type={type} {...rest} />;
  },
  a: ({ href, children, ...rest }) => {
    if (href && /^https?:/i.test(href)) {
      return (
        <a
          href={href}
          data-external-url={href}
          target="_blank"
          rel="noopener noreferrer"
          {...rest}
        >
          {children}
        </a>
      );
    }

    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
};

interface MarkdownProps {
  className?: string;
  text: string;
}

// Renders markdown to React elements (not innerHTML) so surrounding re-renders
// don't tear down the DOM subtree and wipe active text selection. Memoized on
// `text` for extra insurance against parent re-render churn.
export const Markdown = memo(function Markdown({
  className,
  text,
}: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={components}
        rehypePlugins={[rehypeFileLinks]}
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={urlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
