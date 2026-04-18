import type { DeviceInfo } from "../../../lib/types";
import { Button, Dialog } from "@argus/peacock";
import { useDeviceNavigation } from "../deviceNav";
import { ConductorLogPanel } from "./ConductorLogPanel";
import styles from "./DeviceDialog.module.css";
import { DevicePreview } from "./DevicePreview";

interface DeviceDialogProps {
  device: DeviceInfo;
  onClose: () => void;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export function DeviceDialog({ device, onClose }: DeviceDialogProps) {
  const { goto } = useDeviceNavigation();

  const handleGoto = async (
    kind: "agent" | "project" | "workspace",
  ): Promise<void> => {
    await goto(device, kind);
    onClose();
  };

  return (
    <Dialog
      className={styles.dialog}
      title={device.name}
      titleId="device-dialog-title"
      titleExtra={
        <span
          style={{
            marginLeft: 10,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
          }}
        >
          {device.platform}
          {device.online ? " · online" : " · offline"}
        </span>
      }
      onClose={onClose}
    >
      <div className={styles.body}>
        <div className={styles.col}>
          <div className={styles.meta}>
            <span className={styles.metaLabel}>Key</span>
            <span className={styles.metaValue}>{device.deviceKey}</span>
            {device.runtime && (
              <>
                <span className={styles.metaLabel}>Runtime</span>
                <span className={styles.metaValue}>{device.runtime}</span>
              </>
            )}
            <span className={styles.metaLabel}>Agent</span>
            <span className={styles.metaValue}>
              {device.agentId ? (
                <button
                  className={styles.link}
                  onClick={() => handleGoto("agent")}
                >
                  {device.agentId}
                </button>
              ) : (
                "—"
              )}
            </span>
            <span className={styles.metaLabel}>Workspace</span>
            <span className={styles.metaValue}>
              {device.workspaceId ? (
                <button
                  className={styles.link}
                  onClick={() => handleGoto("workspace")}
                >
                  {device.workspaceId}
                </button>
              ) : (
                "—"
              )}
            </span>
            <span className={styles.metaLabel}>Project</span>
            <span className={styles.metaValue}>
              {device.repoRoot ? (
                <button
                  className={styles.link}
                  onClick={() => handleGoto("project")}
                >
                  {basename(device.repoRoot)}
                </button>
              ) : (
                "—"
              )}
            </span>
          </div>

          <div className={styles.preview}>
            <DevicePreview device={device} />
          </div>
        </div>

        <div className={styles.col}>
          <ConductorLogPanel deviceKey={device.deviceKey} />
          <div className={styles.actions}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
