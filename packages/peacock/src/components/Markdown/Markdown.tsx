import { memo, type ReactNode, useMemo, useRef } from "react";
import ReactMarkdown, {
  type Components,
  type Options,
  defaultUrlTransform,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

const URI_ALLOW =
  /^(?:(?:https?|mailto|tel|argus-file|argus-ext|extension-file|file|vscode):|[#/])/i;

function urlTransform(url: string): string {
  if (URI_ALLOW.test(url)) {
    return url;
  }

  return defaultUrlTransform(url);
}

/** Minimal shape of the hast <pre> node we inspect for mermaid fenced code. */
interface HastNode {
  children?: {
    type?: string;
    tagName?: string;
    properties?: { className?: unknown };
    children?: { type?: string; value?: string }[];
  }[];
}

/** Pull the raw text from a ```mermaid fenced code node, or null otherwise. */
function mermaidCode(node: HastNode | undefined): string | null {
  const codeNode = node?.children?.[0];
  if (!codeNode || codeNode.type !== "element" || codeNode.tagName !== "code") {
    return null;
  }
  const cls = codeNode.properties?.className;
  const classes = Array.isArray(cls) ? cls.map(String) : [];
  if (!classes.includes("language-mermaid")) {
    return null;
  }
  const text = codeNode.children?.[0];

  return text?.type === "text" ? (text.value ?? "").replace(/\n$/, "") : "";
}

export interface MarkdownProps {
  className?: string;
  text: string;
  /**
   * Extra rehype plugins. Desktop injects file-path linkification here; web
   * leaves it empty.
   */
  rehypePlugins?: Options["rehypePlugins"];
  /**
   * Render a ```mermaid fenced block. When omitted the block renders as a
   * plain <pre>, so the base component has no mermaid dependency.
   */
  renderMermaid?: (code: string) => ReactNode;
  /**
   * Apply the built-in prose stylesheet. Default `true`. Set `false` when the
   * caller's `className` already carries all the prose styling (avoids
   * double-styling on surfaces that predate this component).
   */
  baseProse?: boolean;
  /**
   * Called before an http(s) link opens. Return true to handle it in-app (the
   * default navigation is then cancelled), false to let it open as usual.
   */
  onLinkClick?: (url: string) => boolean;
  /**
   * Swap a link or image for something richer (an inline video player, an
   * image that needs a signed-in download). Return null to render it as usual.
   */
  renderEmbed?: (
    kind: "image" | "link",
    url: string,
    label: string,
  ) => ReactNode | null;
}

/** The plain text inside a link, for naming what it points at. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }

  return "";
}

/**
 * Prop-driven markdown renderer shared by the desktop chat and the web client.
 * Prose / code / table styling lives in `Markdown.module.css`; platform
 * behaviour (file links, mermaid) is injected via props.
 *
 * Renders to React elements (not innerHTML) so surrounding re-renders don't
 * tear down the subtree and wipe active text selection.
 */
export const Markdown = memo(function Markdown({
  className,
  text,
  rehypePlugins,
  renderMermaid,
  baseProse = true,
  onLinkClick,
  renderEmbed,
}: MarkdownProps) {
  // Read through a ref so a new handler doesn't remount the rendered tree.
  const onLinkClickRef = useRef(onLinkClick);
  onLinkClickRef.current = onLinkClick;
  const renderEmbedRef = useRef(renderEmbed);
  renderEmbedRef.current = renderEmbed;
  // Memoized so custom component identities stay stable across re-renders;
  // react-markdown treats a new `pre` function as a new type and would
  // otherwise remount the subtree (tearing down inline mermaid diagrams).
  const components: Components = useMemo(
    () => ({
      pre: ({ node, children, ...rest }) => {
        const code = renderMermaid ? mermaidCode(node as HastNode) : null;
        if (code !== null && code !== undefined && renderMermaid) {
          return <>{renderMermaid(code)}</>;
        }

        return <pre {...rest}>{children}</pre>;
      },
      // GFM task-list checkbox → span with data-task-check so every markdown
      // surface renders checkboxes identically.
      input: ({ type, checked, ...rest }) => {
        if (type === "checkbox") {
          return (
            <span
              data-task-check={checked ? "checked" : "unchecked"}
              {...rest}
            />
          );
        }

        return <input type={type} {...rest} />;
      },
      img: ({ src, alt, ...rest }) => {
        const source = typeof src === "string" ? src : undefined;
        const embed =
          source && renderEmbedRef.current?.("image", source, alt ?? "");
        if (embed) {
          return <>{embed}</>;
        }

        return <img alt={alt} src={source} {...rest} />;
      },
      a: ({ href, children, ...rest }) => {
        const embed =
          href && renderEmbedRef.current?.("link", href, textOf(children));
        if (embed) {
          return <>{embed}</>;
        }
        if (href && /^https?:/i.test(href)) {
          return (
            <a
              href={href}
              data-external-url={href}
              target="_blank"
              rel="noopener noreferrer"
              {...rest}
              onClick={(e) => {
                if (onLinkClickRef.current?.(href)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
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
    }),
    [renderMermaid],
  );

  const wrapperClass = [baseProse ? styles.markdown : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClass}>
      <ReactMarkdown
        components={components}
        rehypePlugins={rehypePlugins}
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={urlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
