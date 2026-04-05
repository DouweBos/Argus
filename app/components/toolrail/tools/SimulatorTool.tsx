import { SimulatorView } from "../../runtime/SimulatorView";

interface SimulatorToolProps {
  workspaceId: null | string;
}

export function SimulatorTool({ workspaceId }: SimulatorToolProps) {
  return <SimulatorView workspaceId={workspaceId} />;
}
