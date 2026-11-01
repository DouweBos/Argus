import type { CodeLine } from "./highlight";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./CodeViewer.module.css";

export interface CodeViewerProps {
  code: string;
  /** A highlight.js language id; anything unbundled reads as plain text. */
  language?: string | null;
  /** 1-based line to scroll to and mark. */
  focusLine?: number | null;
  /** Soft-wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  className?: string;
}

/** Past this the file shows as plain text: highlighting it would stall the page. */
const HIGHLIGHT_LIMIT = 400_000;

const SCOPE_CLASS: Record<string, string | undefined> = {
  addition: styles.addition,
  attr: styles.attr,
  attribute: styles.attr,
  built_in: styles.type,
  bullet: styles.meta,
  char: styles.string,
  comment: styles.comment,
  deletion: styles.deletion,
  doctag: styles.keyword,
  emphasis: styles.emphasis,
  keyword: styles.keyword,
  link: styles.string,
  literal: styles.keyword,
  meta: styles.meta,
  name: styles.attr,
  number: styles.number,
  operator: styles.meta,
  property: styles.attr,
  quote: styles.comment,
  regexp: styles.string,
  section: styles.title,
  "selector-attr": styles.attr,
  "selector-class": styles.attr,
  "selector-id": styles.attr,
  "selector-pseudo": styles.attr,
  "selector-tag": styles.keyword,
  string: styles.string,
  strong: styles.strong,
  subst: styles.variable,
  symbol: styles.string,
  tag: styles.meta,
  "template-variable": styles.variable,
  title: styles.title,
  type: styles.type,
  variable: styles.variable,
};

function classFor(scopes: string[]): string | undefined {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const cls = SCOPE_CLASS[scopes[i]];
    if (cls) {
      return cls;
    }
  }

  return undefined;
}

/** The lines to show until (or unless) the highlighter has run. */
function plainLines(code: string): CodeLine[] {
  return code.split("\n").map((text) => (text ? [{ text, scopes: [] }] : []));
}

/**
 * A read-only source file: line numbers, syntax highlighting (its grammars
 * load on first use), and an optional line to reveal.
 */
export function CodeViewer({
  code,
  language,
  focusLine,
  wrap = false,
  className,
}: CodeViewerProps) {
  const plain = useMemo(() => plainLines(code.replace(/\r\n/g, "\n")), [code]);
  const [highlighted, setHighlighted] = useState<{
    key: string;
    lines: CodeLine[];
  } | null>(null);
  const key = `${language ?? ""}\u0000${code}`;
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!language || code.length > HIGHLIGHT_LIMIT) {
      return;
    }
    let cancelled = false;
    import("./highlight")
      .then(({ highlightLines }) => {
        const lines = highlightLines(code.replace(/\r\n/g, "\n"), language);
        if (!cancelled && lines) {
          setHighlighted({ key, lines });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [code, language, key]);

  const lines = highlighted?.key === key ? highlighted.lines : plain;
  // A trailing newline isn't a line of its own.
  const shown =
    lines.length > 1 && lines.at(-1)?.length === 0 ? lines.slice(0, -1) : lines;

  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: "center" });
  }, [focusLine, code]);

  return (
    <div
      className={[styles.viewer, wrap ? styles.wrap : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-language={language ?? undefined}
    >
      <div className={styles.lines} role="table" aria-label="File contents">
        {shown.map((runs, index) => {
          const number = index + 1;
          const focused = number === focusLine;

          return (
            <div
              key={number}
              ref={focused ? focusRef : undefined}
              className={`${styles.line} ${focused ? styles.focused : ""}`}
              role="row"
            >
              <span className={styles.gutter} role="rowheader">
                {number}
              </span>
              <code className={styles.code} role="cell">
                {runs.length === 0
                  ? "​"
                  : runs.map((run, i) => {
                      const cls = classFor(run.scopes);

                      return cls ? (
                        <span key={i} className={cls}>
                          {run.text}
                        </span>
                      ) : (
                        run.text
                      );
                    })}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
