import type { SVGProps } from "react";
import { useLocation } from "react-router-dom";
import { Icons } from "@argus/peacock";
import { setCenterView } from "../../../stores/centerViewStore";
import {
  type ToolId,
  toggleTool,
  useActiveToolId,
} from "../../../stores/layoutStore";
import {
  useNotifications,
  useUnseenNotificationCount,
} from "../../../stores/notificationsStore";
import { selectWorkspace, useSelectedWorkspaceId } from "../../../stores/workspaceStore";
import styles from "./ToolRail.module.css";

type IconComponent = React.ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

interface ToolDef {
  icon: IconComponent;
  id: ToolId;
  label: string;
}

const TOOLS: ToolDef[] = [
  { id: "changes", label: "Changes", icon: Icons.GitChangesIcon },
  { id: "terminal", label: "Terminal", icon: Icons.TerminalToolIcon },
  { id: "simulator", label: "Simulator", icon: Icons.SimulatorIcon },
];

export function ToolRail() {
  const activeToolId = useActiveToolId();
  const selectedWorkspaceId = useSelectedWorkspaceId();
  const location = useLocation();
  const notifications = useNotifications();
  const unseen = useUnseenNotificationCount();

  const notificationsActive =
    location.pathname.replace(/\/+$/, "") === "/notifications";
  const hasEntries = notifications.length > 0;
  const hasError = notifications.some((n) => n.level === "error");

  const openNotifications = () => {
    if (notificationsActive) {
      return;
    }
    selectWorkspace(null);
    setCenterView("notifications");
  };

  return (
    <div className={styles.rail}>
      {selectedWorkspaceId !== null &&
        TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={label}
            className={`${styles.tool} ${activeToolId === id ? styles.active : ""}`}
            title={label}
            onClick={() => toggleTool(id)}
          >
            <Icon size={18} />
          </button>
        ))}

      <div className={styles.spacer} />

      <button
        aria-label="Warnings and errors"
        className={`${styles.tool} ${notificationsActive ? styles.active : ""}`}
        title="Warnings & errors"
        onClick={openNotifications}
      >
        <Icons.WarningIcon size={18} />
        {hasEntries && (
          <span
            className={`${styles.badge} ${hasError ? styles.badgeError : styles.badgeWarning}`}
            data-unseen={unseen > 0 ? "true" : "false"}
          >
            {notifications.length > 99 ? "99+" : notifications.length}
          </span>
        )}
      </button>
    </div>
  );
}
