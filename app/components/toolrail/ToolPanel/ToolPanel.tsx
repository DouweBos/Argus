import { useLayoutEffect, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import {
  type ToolId,
  TOOL_PLACEMENT,
  setRightPanelWidth,
  toggleTool,
  useActiveToolId,
  useLastActiveToolId,
  useMountedToolIds,
} from "../../../stores/layoutStore";
import { ResizablePanel } from "../../layout/ResizablePanel";
import { ChangesSummary } from "../tools/ChangesSummary";
import { SimulatorTool } from "../tools/SimulatorTool";
import styles from "./ToolPanel.module.css";

const TOOL_LABELS: Record<ToolId, string> = {
  changes: "Changes",
  terminal: "Terminal",
  simulator: "Simulator",
  debug: "Debug",
  notifications: "Notifications",
};

const RIGHT_TOOL_IDS: ToolId[] = (
  ["changes", "terminal", "simulator", "debug"] as ToolId[]
).filter((id) => TOOL_PLACEMENT[id] === "right");

function renderToolContent(id: ToolId, sessionId: string | null) {
  switch (id) {
    case "changes":
      return <ChangesSummary sessionId={sessionId} />;
    case "simulator":
      return <SimulatorTool sessionId={sessionId} />;
    default:
      return null;
  }
}

interface ToolPanelProps {
  sessionId: string | null;
}

export function ToolPanel({ sessionId }: ToolPanelProps) {
  const activeToolId = useActiveToolId("right");
  const setWidth = setRightPanelWidth;
  const mountedToolIds = useMountedToolIds();

  const lastActiveToolId = useLastActiveToolId("right");
  const displayToolId = activeToolId ?? lastActiveToolId;

  const prevSessionIdRef = useRef(sessionId);
  const [noAnimate, setNoAnimate] = useState(false);
  useLayoutEffect(() => {
    if (prevSessionIdRef.current === sessionId) {
      return;
    }
    prevSessionIdRef.current = sessionId;
    /* eslint-disable react-hooks/set-state-in-effect --
       One-frame flag flip is the whole point: we need the flag ON during
       the commit that follows a session change and OFF once the frame
       has painted. There's no external-state source to derive from. */
    setNoAnimate(true);
    const raf = requestAnimationFrame(() => setNoAnimate(false));
    /* eslint-enable react-hooks/set-state-in-effect */

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
          {RIGHT_TOOL_IDS.map((id) => (
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
