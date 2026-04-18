import type { SVGProps } from "react";
import { Icons } from "@argus/peacock";
import {
  type ToolId,
  toggleTool,
  useActiveToolId,
} from "../../../stores/layoutStore";
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
