import { RuntimeView } from "../../../runtime/SimulatorView";

interface SimulatorToolProps {
  workspaceId: string | null;
}

export function SimulatorTool({ workspaceId }: SimulatorToolProps) {
  return <RuntimeView workspaceId={workspaceId} />;
}
