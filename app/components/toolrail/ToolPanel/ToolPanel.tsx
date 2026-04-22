import { useLayoutEffect, useRef, useState } from "react";
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

function renderToolContent(id: ToolId, sessionId: string | null) {
  switch (id) {
    case "changes":
      return <ChangesSummary sessionId={sessionId} />;
    case "terminal":
      return <TerminalTool sessionId={sessionId} />;
    case "simulator":
      return <SimulatorTool sessionId={sessionId} />;
    default: {
      const _exhaustive: never = id;

      return _exhaustive;
    }
  }
}

interface ToolPanelProps {
  sessionId: string | null;
}

export function ToolPanel({ sessionId }: ToolPanelProps) {
  const activeToolId = useActiveToolId();
  const setWidth = setToolPanelWidth;
  const mountedToolIds = useMountedToolIds();

  // Remember last active tool so the header stays correct during close animation
  const lastActiveToolId = useLastActiveToolId();
  const displayToolId = activeToolId ?? lastActiveToolId;

  // Skip the open/close transition when the panel's visibility flips because
  // of a session change (navigation) rather than a user toggle. useLayoutEffect
  // runs before paint, so the DOM commit with `data-no-animate="true"` lands
  // in the same frame as the new `collapsed` value — the browser sees only
  // the final state and snaps to it without animating.
  const prevSessionIdRef = useRef(sessionId);
  const [noAnimate, setNoAnimate] = useState(false);
  useLayoutEffect(() => {
    if (prevSessionIdRef.current === sessionId) {
      return;
    }
    prevSessionIdRef.current = sessionId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: disable animation for one frame on session change
    setNoAnimate(true);
    const raf = requestAnimationFrame(() => setNoAnimate(false));

    return () => cancelAnimationFrame(raf);
  }, [sessionId]);

  return (
    <ResizablePanel
      collapsed={!activeToolId}
      defaultWidth={0.3}
      maxWidth={0.5}
      minWidth={0.15}
      noAnimate={noAnimate}
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
              {mountedToolIds[id] && renderToolContent(id, sessionId)}
            </div>
          ))}
        </div>
      </div>
    </ResizablePanel>
  );
}
