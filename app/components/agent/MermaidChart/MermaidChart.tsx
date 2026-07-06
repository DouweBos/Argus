import { Icons } from "@argus/peacock";
import { openDiagramViewer } from "../../../stores/diagramViewerStore";
import { MermaidDiagram } from "../MermaidDiagram/MermaidDiagram";
import styles from "./MermaidChart.module.css";

interface MermaidChartProps {
  code: string;
}

/** Inline Mermaid diagram in a chat message, with an expand-to-modal button. */
export function MermaidChart({ code }: MermaidChartProps) {
  return (
    <div className={styles.wrap}>
      <button
        aria-label="Open diagram"
        className={styles.expandBtn}
        onClick={() => openDiagramViewer(code)}
        title="Open diagram"
        type="button"
      >
        <Icons.EnlargeIcon size={12} />
      </button>
      <MermaidDiagram className={styles.diagram} code={code} />
    </div>
  );
}
