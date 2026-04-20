import { RuntimeView } from "../../../runtime/SimulatorView";

interface SimulatorToolProps {
  sessionId: string | null;
}

export function SimulatorTool({ sessionId }: SimulatorToolProps) {
  return <RuntimeView sessionId={sessionId} />;
}
