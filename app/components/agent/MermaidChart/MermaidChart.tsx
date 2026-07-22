import { useState } from "react";
import { Icons } from "@argus/peacock";
import { openDiagramViewer } from "../../../stores/diagramViewerStore";
import { MermaidDiagram } from "../MermaidDiagram/MermaidDiagram";
import styles from "./MermaidChart.module.css";

interface MermaidChartProps {
  code: string;
}

/** Inline Mermaid diagram in a chat message, with view toggle, copy, and expand. */
export function MermaidChart({ code }: MermaidChartProps) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          aria-label={copied ? "Copied" : "Copy source"}
          className={styles.btn}
          onClick={copyCode}
          title={copied ? "Copied" : "Copy source"}
          type="button"
        >
          {copied ? (
            <Icons.CheckIcon size={12} />
          ) : (
            <Icons.CopyIcon size={12} />
          )}
        </button>
        <button
          aria-label={showCode ? "Show diagram" : "Show source"}
          aria-pressed={showCode}
          className={`${styles.btn} ${showCode ? styles.btnActive : ""}`}
          onClick={() => setShowCode((v) => !v)}
          title={showCode ? "Show diagram" : "Show source"}
          type="button"
        >
          <Icons.CodeIcon size={12} />
        </button>
        {!showCode && (
          <button
            aria-label="Open diagram"
            className={styles.btn}
            onClick={() => openDiagramViewer(code)}
            title="Open diagram"
            type="button"
          >
            <Icons.EnlargeIcon size={12} />
          </button>
        )}
      </div>
      {showCode ? (
        <pre className={styles.source}>
          <code>{code}</code>
        </pre>
      ) : (
        <MermaidDiagram className={styles.diagram} code={code} />
      )}
    </div>
  );
}
