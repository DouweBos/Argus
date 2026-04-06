import { useSimulatorStore } from "../../stores/simulatorStore";
import { IosSimulatorView } from "./IosSimulatorView";
import { AndroidDeviceView } from "./AndroidDeviceView";
import styles from "./SimulatorView.module.css";

interface SimulatorViewProps {
  workspaceId: null | string;
}

/**
 * Thin wrapper: renders the platform toggle as children into whichever
 * platform view is active. The platform view owns the title bar and places
 * the toggle alongside its own device picker and action buttons.
 */
export function SimulatorView({ workspaceId }: SimulatorViewProps) {
  const { platform, setPlatform } = useSimulatorStore();

  const toggle = (
    <div className={styles.platformToggle}>
      <PlatformButton
        active={platform === "ios"}
        onClick={() => setPlatform("ios")}
      >
        iOS
      </PlatformButton>
      <PlatformButton
        active={platform === "android"}
        onClick={() => setPlatform("android")}
      >
        Android
      </PlatformButton>
    </div>
  );

  return (
    <div className={styles.layout}>
      {platform === "ios" ? (
        <IosSimulatorView workspaceId={workspaceId}>{toggle}</IosSimulatorView>
      ) : (
        <AndroidDeviceView workspaceId={workspaceId}>
          {toggle}
        </AndroidDeviceView>
      )}
    </div>
  );
}

function PlatformButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`${styles.platformBtn} ${active ? styles.platformBtnActive : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
