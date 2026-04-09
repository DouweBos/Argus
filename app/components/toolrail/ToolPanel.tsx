import { useLayoutStore, type ToolId } from "../../stores/layoutStore";
import { ResizablePanel } from "../layout/ResizablePanel";
import { CloseIcon } from "../shared/Icons";
import { ChangesSummary } from "./tools/ChangesSummary";
import { TerminalTool } from "./tools/TerminalTool";
import { SimulatorTool } from "./tools/SimulatorTool";
import styles from "./ToolPanel.module.css";

const TOOL_LABELS: Record<ToolId, string> = {
  changes: "Changes",
  terminal: "Terminal",
  simulator: "Simulator",
};

const ALL_TOOL_IDS: ToolId[] = ["changes", "terminal", "simulator"];

interface ToolPanelProps {
  workspaceId: null | string;
}

export function ToolPanel({ workspaceId }: ToolPanelProps) {
  const activeToolId = useLayoutStore((s) => s.activeToolId);
  const toggleTool = useLayoutStore((s) => s.toggleTool);
  const setWidth = useLayoutStore((s) => s.setToolPanelWidth);

  // Remember last active tool so the header stays correct during close animation
  const lastActiveToolId = useLayoutStore((s) => s.lastActiveToolId);
  const displayToolId = activeToolId ?? lastActiveToolId;

  return (
    <ResizablePanel
      collapsed={!activeToolId}
      defaultWidth={0.3}
      minWidth={0.15}
      maxWidth={0.5}
      side="right"
      onResize={setWidth}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>{TOOL_LABELS[displayToolId]}</span>
          <button
            className={styles.closeBtn}
            onClick={() => activeToolId && toggleTool(activeToolId)}
            title="Close panel"
          >
            <CloseIcon size={10} />
          </button>
        </div>
        <div className={styles.content}>
          {ALL_TOOL_IDS.map((id) => (
            <div
              key={id}
              className={styles.toolSlot}
              data-visible={id === displayToolId}
            >
              {id === "changes" && <ChangesSummary workspaceId={workspaceId} />}
              {id === "terminal" && <TerminalTool workspaceId={workspaceId} />}
              {id === "simulator" && (
                <SimulatorTool workspaceId={workspaceId} />
              )}
            </div>
          ))}
        </div>
      </div>
    </ResizablePanel>
  );
}
