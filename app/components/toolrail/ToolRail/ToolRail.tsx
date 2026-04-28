import { useState, type SVGProps } from "react";
import { FeedbackDialog, Icons } from "@argus/peacock";
import { createLogger } from "../../../lib/logger";
import {
  captureFeedback,
  getFeedbackUnavailableReason,
} from "../../../lib/telemetry";
import {
  type ToolId,
  TOOL_PLACEMENT,
  toggleTool,
  useActiveToolId,
} from "../../../stores/layoutStore";
import {
  useNotifications,
  useUnseenNotificationCount,
} from "../../../stores/notificationsStore";
import { useSelectedSessionId } from "../../../stores/sessionStore";
import styles from "./ToolRail.module.css";

const log = createLogger("feedback");

type IconComponent = React.ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

interface ToolDef {
  icon: IconComponent;
  id: ToolId;
  label: string;
}

const TOP_TOOLS: ToolDef[] = [
  { id: "changes", label: "Changes", icon: Icons.GitChangesIcon },
  { id: "simulator", label: "Simulator", icon: Icons.SimulatorIcon },
];

const BOTTOM_TOOLS: ToolDef[] = [
  { id: "terminal", label: "Terminal", icon: Icons.TerminalToolIcon },
  { id: "debug", label: "Debug", icon: Icons.BugIcon },
  { id: "notifications", label: "Warnings & errors", icon: Icons.WarningIcon },
];

export function ToolRail() {
  const activeRightToolId = useActiveToolId("right");
  const activeBottomToolId = useActiveToolId("bottom");
  const selectedSessionId = useSelectedSessionId();
  const notifications = useNotifications();
  const unseen = useUnseenNotificationCount();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const hasEntries = notifications.length > 0;
  const hasError = notifications.some((n) => n.level === "error");

  const renderTool = ({ id, label, icon: Icon }: ToolDef) => {
    const active =
      TOOL_PLACEMENT[id] === "right"
        ? activeRightToolId === id
        : activeBottomToolId === id;

    return (
      <button
        key={id}
        aria-label={label}
        className={`${styles.tool} ${active ? styles.active : ""}`}
        title={label}
        onClick={() => toggleTool(id)}
      >
        <Icon size={18} />
        {id === "notifications" && hasEntries && (
          <span
            className={`${styles.badge} ${hasError ? styles.badgeError : styles.badgeWarning}`}
            data-unseen={unseen > 0 ? "true" : "false"}
          >
            {notifications.length > 99 ? "99+" : notifications.length}
          </span>
        )}
      </button>
    );
  };

  // Without a session most tools have no context — only the notifications
  // tool is global. Keep the rail and the notifications button visible so
  // the home screen still surfaces background warnings/errors.
  const topTools = selectedSessionId === null ? [] : TOP_TOOLS;
  const bottomTools =
    selectedSessionId === null
      ? BOTTOM_TOOLS.filter((t) => t.id === "notifications")
      : BOTTOM_TOOLS;

  const feedbackButton = (
    <button
      aria-label="Send feedback"
      className={styles.tool}
      title="Send feedback"
      type="button"
      onClick={() => {
        setFeedbackOpen(true);
      }}
    >
      <Icons.QuestionIcon size={18} />
    </button>
  );

  return (
    <div className={styles.rail}>
      {topTools.map(renderTool)}
      <div className={styles.spacer} />
      {bottomTools.map(renderTool)}
      {feedbackButton}
      {feedbackOpen && (
        <FeedbackDialog
          onClose={() => setFeedbackOpen(false)}
          unavailableReason={getFeedbackUnavailableReason()}
          onSubmit={(message) => {
            try {
              captureFeedback(message);
            } catch (e) {
              log.warn("submit failed", e);
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}
