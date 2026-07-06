import { useEffect, useId, useRef, useState } from "react";
import {
  invalidateMermaidTheme,
  parseMermaid,
  renderMermaid,
} from "../../../lib/mermaid";
import { useResolvedTheme } from "../../../stores/themeStore";
import styles from "./MermaidDiagram.module.css";

interface MermaidDiagramProps {
  className?: string;
  code: string;
  /** Debounce before rendering; higher while streaming to avoid thrash. */
  debounceMs?: number;
}

/**
 * Renders Mermaid source to an inline SVG. While the source is incomplete
 * (streaming) or invalid, falls back to the raw code fence instead of erroring.
 */
export function MermaidDiagram({
  className,
  code,
  debounceMs = 120,
}: MermaidDiagramProps) {
  const rawId = useId();
  const renderId = `mermaid-${rawId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const theme = useResolvedTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;
    invalidateMermaidTheme();

    const timer = setTimeout(async () => {
      try {
        if (!(await parseMermaid(code))) {
          if (runRef.current === run) {
            setSvg(null);
          }

          return;
        }
        const rendered = await renderMermaid(renderId, code);
        if (runRef.current === run) {
          setSvg(rendered);
        }
      } catch {
        if (runRef.current === run) {
          setSvg(null);
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [code, renderId, debounceMs, theme]);

  if (svg) {
    return (
      <div
        className={`${styles.diagram} ${className ?? ""}`}
        // Runtime-generated SVG from mermaid; sanitized via securityLevel:strict.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <pre className={`${styles.fallback} ${className ?? ""}`}>
      <code>{code}</code>
    </pre>
  );
}
