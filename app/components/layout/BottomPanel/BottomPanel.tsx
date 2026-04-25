import { useLayoutEffect, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import {
  type ToolId,
  TOOL_PLACEMENT,
  setBottomPanelHeight,
  toggleTool,
  useActiveToolId,
  useLastActiveToolId,
  useMountedToolIds,
} from "../../../stores/layoutStore";
import { DebugTool } from "../../toolrail/tools/DebugTool";
import { NotificationsTool } from "../../toolrail/tools/NotificationsTool";
import { TerminalTool } from "../../toolrail/tools/TerminalTool";
import { ResizablePanel } from "../ResizablePanel";
import styles from "./BottomPanel.module.css";

const TOOL_LABELS: Record<ToolId, string> = {
  changes: "Changes",
  terminal: "Terminal",
  simulator: "Simulator",
  debug: "Debug",
  notifications: "Notifications",
};

const BOTTOM_TOOL_IDS: ToolId[] = (
  ["terminal", "debug", "notifications"] as ToolId[]
).filter((id) => TOOL_PLACEMENT[id] === "bottom");

function renderToolContent(id: ToolId, sessionId: string | null) {
  switch (id) {
    case "terminal":
      return <TerminalTool sessionId={sessionId} />;
    case "debug":
      return <DebugTool sessionId={sessionId} />;
    case "notifications":
      return <NotificationsTool />;
    default:
      return null;
  }
}

interface BottomPanelProps {
  sessionId: string | null;
}

export function BottomPanel({ sessionId }: BottomPanelProps) {
  const activeToolId = useActiveToolId("bottom");
  const mountedToolIds = useMountedToolIds();

  const lastActiveToolId = useLastActiveToolId("bottom");
  const displayToolId = activeToolId ?? lastActiveToolId;

  const prevSessionIdRef = useRef(sessionId);
  const [noAnimate, setNoAnimate] = useState(false);
  useLayoutEffect(() => {
    if (prevSessionIdRef.current === sessionId) {
      return;
    }
    prevSessionIdRef.current = sessionId;
    /* eslint-disable react-hooks/set-state-in-effect --
       One-frame flag flip mirrors ToolPanel: we want the panel to snap to
       its new collapsed state on session navigation, not animate. */
    setNoAnimate(true);
    const raf = requestAnimationFrame(() => setNoAnimate(false));
    /* eslint-enable react-hooks/set-state-in-effect */

    return () => cancelAnimationFrame(raf);
  }, [sessionId]);

  return (
    <ResizablePanel
      collapsed={!activeToolId}
      defaultWidth={0.3}
      maxWidth={0.7}
      minWidth={0.15}
      noAnimate={noAnimate}
      side="bottom"
      onResize={setBottomPanelHeight}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            {BOTTOM_TOOL_IDS.map((id) => (
              <button
                key={id}
                className={styles.tab}
                data-active={id === displayToolId}
                onClick={() => toggleTool(id)}
              >
                {TOOL_LABELS[id]}
              </button>
            ))}
          </div>
          <button
            className={styles.closeBtn}
            title="Close panel"
            onClick={() => activeToolId && toggleTool(activeToolId)}
          >
            <Icons.CloseIcon size={10} />
          </button>
        </div>
        <div className={styles.content}>
          {BOTTOM_TOOL_IDS.map((id) => (
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
