import type { IconProps } from "../../shared/Icons";
import {
  type ToolId,
  toggleTool,
  useActiveToolId,
} from "../../../stores/layoutStore";
import {
  GitChangesIcon,
  SimulatorIcon,
  TerminalToolIcon,
} from "../../shared/Icons";
import styles from "./ToolRail.module.css";

interface ToolDef {
  icon: React.ComponentType<IconProps>;
  id: ToolId;
  label: string;
}

const TOOLS: ToolDef[] = [
  { id: "changes", label: "Changes", icon: GitChangesIcon },
  { id: "terminal", label: "Terminal", icon: TerminalToolIcon },
  { id: "simulator", label: "Simulator", icon: SimulatorIcon },
];

export function ToolRail() {
  const activeToolId = useActiveToolId();

  return (
    <div className={styles.rail}>
      {TOOLS.map(({ id, label, icon: Icon }) => (
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
    </div>
  );
}
