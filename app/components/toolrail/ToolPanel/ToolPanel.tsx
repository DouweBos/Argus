import { Icons } from "@argus/peacock";
import {
  type ToolId,
  setToolPanelWidth,
  toggleTool,
  useActiveToolId,
  useLastActiveToolId,
  useMountedToolIds,
} from "../../../stores/layoutStore";
import { ResizablePanel } from "../../layout/ResizablePanel";
import { ChangesSummary } from "../tools/ChangesSummary";
import { SimulatorTool } from "../tools/SimulatorTool";
import { TerminalTool } from "../tools/TerminalTool";
import styles from "./ToolPanel.module.css";

const TOOL_LABELS: Record<ToolId, string> = {
  changes: "Changes",
  terminal: "Terminal",
  simulator: "Simulator",
};

const ALL_TOOL_IDS: ToolId[] = ["changes", "terminal", "simulator"];

function renderToolContent(id: ToolId, workspaceId: string | null) {
  switch (id) {
    case "changes":
      return <ChangesSummary workspaceId={workspaceId} />;
    case "terminal":
      return <TerminalTool workspaceId={workspaceId} />;
    case "simulator":
      return <SimulatorTool workspaceId={workspaceId} />;
    default: {
      const _exhaustive: never = id;

      return _exhaustive;
    }
  }
}

interface ToolPanelProps {
  workspaceId: string | null;
}

export function ToolPanel({ workspaceId }: ToolPanelProps) {
  const activeToolId = useActiveToolId();
  const setWidth = setToolPanelWidth;
  const mountedToolIds = useMountedToolIds();

  // Remember last active tool so the header stays correct during close animation
  const lastActiveToolId = useLastActiveToolId();
  const displayToolId = activeToolId ?? lastActiveToolId;

  return (
    <ResizablePanel
      collapsed={!activeToolId}
      defaultWidth={0.3}
      maxWidth={0.5}
      minWidth={0.15}
      side="right"
      onResize={setWidth}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>{TOOL_LABELS[displayToolId]}</span>
          <button
            className={styles.closeBtn}
            title="Close panel"
            onClick={() => activeToolId && toggleTool(activeToolId)}
          >
            <Icons.CloseIcon size={10} />
          </button>
        </div>
        <div className={styles.content}>
          {ALL_TOOL_IDS.map((id) => (
            <div
              key={id}
              className={styles.toolSlot}
              data-visible={id === displayToolId}
            >
              {mountedToolIds[id] && renderToolContent(id, workspaceId)}
            </div>
          ))}
        </div>
      </div>
    </ResizablePanel>
  );
}
