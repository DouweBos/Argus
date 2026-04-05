import { useMemo } from "react";
import { useLayoutStore, type ToolId } from "../../stores/layoutStore";
import {
  GitChangesIcon,
  TerminalToolIcon,
  SimulatorIcon,
} from "../shared/Icons";
import type { IconProps } from "../shared/Icons";
import styles from "./ToolRail.module.css";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: React.ComponentType<IconProps>;
  requiresWorkspace?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: "changes", label: "Changes", icon: GitChangesIcon, requiresWorkspace: true },
  { id: "terminal", label: "Terminal", icon: TerminalToolIcon },
  { id: "simulator", label: "Simulator", icon: SimulatorIcon },
];

interface ToolRailProps {
  hasWorkspace?: boolean;
}

export function ToolRail({ hasWorkspace }: ToolRailProps) {
  const activeToolId = useLayoutStore((s) => s.activeToolId);
  const toggleTool = useLayoutStore((s) => s.toggleTool);

  const visibleTools = useMemo(
    () => TOOLS.filter((t) => !t.requiresWorkspace || hasWorkspace),
    [hasWorkspace],
  );

  return (
    <div className={styles.rail}>
      {visibleTools.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`${styles.tool} ${activeToolId === id ? styles.active : ""}`}
          onClick={() => toggleTool(id)}
          title={label}
          aria-label={label}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
