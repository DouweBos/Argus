import { useMemo, useState, type SVGProps } from "react";
import { FeedbackDialog, Icons } from "@argus/peacock";
import { createLogger } from "../../../lib/logger";
import { appNavigate } from "../../../lib/router";
import {
  captureFeedback,
  getFeedbackUnavailableReason,
} from "../../../lib/telemetry";
import {
  type ToolRailId,
  TOOL_PLACEMENT,
  toggleTool,
  useActiveToolId,
} from "../../../stores/layoutStore";
import {
  useNotifications,
  useUnseenNotificationCount,
} from "../../../stores/notificationsStore";
import { useSelectedSessionId } from "../../../stores/sessionStore";
import { useEnabledToolRailContributions } from "../../../tools/store";
import styles from "./ToolRail.module.css";

const log = createLogger("feedback");

type IconComponent = React.ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

interface ToolDef {
  icon: IconComponent;
  id: ToolRailId;
  label: string;
}

// Core tools — always available, not contributed. Tools contribute additional
// rail entries via `useEnabledToolRailContributions()`.
const CORE_TOP_TOOLS: ToolDef[] = [
  { id: "changes", label: "Changes", icon: Icons.GitChangesIcon },
];

const CORE_BOTTOM_TOOLS: ToolDef[] = [
  { id: "terminal", label: "Terminal", icon: Icons.TerminalToolIcon },
  { id: "notifications", label: "Warnings & errors", icon: Icons.WarningIcon },
];

export function ToolRail() {
  const activeRightToolId = useActiveToolId("right");
  const activeBottomToolId = useActiveToolId("bottom");
  const selectedSessionId = useSelectedSessionId();
  const notifications = useNotifications();
  const unseen = useUnseenNotificationCount();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const toolContributions = useEnabledToolRailContributions();

  // Merge core tools with tool contributions, preserving the original
  // visual order: core-top first, then tool-contributed right entries; then
  // (in the bottom group) core entries with tool debug-style entries
  // interleaved before notifications. Notifications always sits last.
  const topTools = useMemo<ToolDef[]>(
    () => [
      ...CORE_TOP_TOOLS,
      ...toolContributions.right.map(({ id, label, icon }) => ({
        id: id as ToolRailId,
        label,
        icon,
      })),
    ],
    [toolContributions.right],
  );
  const bottomTools = useMemo<ToolDef[]>(() => {
    const notificationsTool = CORE_BOTTOM_TOOLS.find(
      (t) => t.id === "notifications",
    );
    const otherCore = CORE_BOTTOM_TOOLS.filter((t) => t.id !== "notifications");
    const contributedBottom: ToolDef[] = toolContributions.bottom.map(
      ({ id, label, icon }) => ({ id: id as ToolRailId, label, icon }),
    );

    return [
      ...otherCore,
      ...contributedBottom,
      ...(notificationsTool ? [notificationsTool] : []),
    ];
  }, [toolContributions.bottom]);

  const hasEntries = notifications.length > 0;
  const hasError = notifications.some((n) => n.level === "error");

  // Tool panels are keyed by session, so there is nothing to toggle on the
  // home screen. Notifications is the one tool that is global — send it to its
  // own screen instead of dropping the click.
  const openTool = (id: ToolRailId) => {
    if (selectedSessionId === null) {
      appNavigate({ view: "notifications" });

      return;
    }
    toggleTool(id);
  };

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
        onClick={() => openTool(id)}
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
  const visibleTopTools = selectedSessionId === null ? [] : topTools;
  const visibleBottomTools =
    selectedSessionId === null
      ? bottomTools.filter((t) => t.id === "notifications")
      : bottomTools;

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
      {visibleTopTools.map(renderTool)}
      <div className={styles.spacer} />
      {visibleBottomTools.map(renderTool)}
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
