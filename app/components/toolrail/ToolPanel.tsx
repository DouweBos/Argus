import { useLayoutStore, type ToolId } from "../../stores/layoutStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { ResizablePanel } from "../layout/ResizablePanel";
import { CloseIcon } from "../shared/Icons";
import { ChangesTool } from "./tools/ChangesTool";
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
  const workspace = useWorkspaceStore((s) =>
    workspaceId
      ? (s.workspaces.find((w) => w.id === workspaceId) ?? null)
      : null,
  );

  if (!activeToolId) return null;

  return (
    <ResizablePanel
      defaultWidth={0.3}
      minWidth={0.15}
      maxWidth={0.5}
      side="right"
      onResize={setWidth}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>{TOOL_LABELS[activeToolId]}</span>
          <button
            className={styles.closeBtn}
            onClick={() => toggleTool(activeToolId)}
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
              data-visible={id === activeToolId}
            >
              {id === "changes" && (
                <ChangesTool
                  workspaceId={workspaceId}
                  baseBranch={workspace?.base_branch}
                  branchName={workspace?.branch}
                  repoRoot={workspace?.repo_root ?? ""}
                />
              )}
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
