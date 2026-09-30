import type { DeviceInfo } from "../../../lib/types";
import { useState } from "react";
import { Button, Dialog, DialogBody, Icons } from "@argus/peacock";
import { bootSimulator, openDevicePopout, stopDevice } from "../../../lib/ipc";
import { refreshDevices } from "../../../stores/deviceStore";
import { useDeviceNavigation } from "../deviceNav";
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
    kind: "agent" | "project" | "session",
  ): Promise<void> => {
    await goto(device, kind);
    onClose();
  };

  // Web runs in an embedded view owned by the main window — not detachable.
  const canPopout = device.platform !== "web";
  const canBoot = device.platform === "ios" && !device.online;
  const canShutdown = device.platform === "ios" && device.online;
  const [booting, setBooting] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  const handlePopout = () => {
    openDevicePopout({
      platform: device.platform,
      deviceKey: device.deviceKey,
      name: device.name,
    }).catch(() => {});
  };

  const handleBoot = async () => {
    if (!canBoot || booting) {
      return;
    }
    setBooting(true);
    try {
      await bootSimulator(device.deviceKey);
      await refreshDevices();
    } catch {
      // Next poll will reflect the result.
    } finally {
      setBooting(false);
    }
  };

  const handleShutdown = async () => {
    if (!canShutdown || shuttingDown || device.platform === "video") {
      return;
    }
    setShuttingDown(true);
    try {
      await stopDevice(device.platform, device.deviceKey);
      await refreshDevices();
    } catch {
      // Next poll will reflect the result.
    } finally {
      setShuttingDown(false);
    }
  };

  return (
    <Dialog
      size="full"
      title={device.name}
      titleId="device-dialog-title"
      titleExtra={
        <span className={styles.titleExtra}>
          {device.platform}
          {device.online ? " · online" : " · offline"}
        </span>
      }
      onClose={onClose}
    >
      <DialogBody>
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
            <span className={styles.metaLabel}>Session</span>
            <span className={styles.metaValue}>
              {device.sessionId ? (
                <button
                  className={styles.link}
                  onClick={() => handleGoto("session")}
                >
                  {device.sessionId}
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

          <div className={styles.actions}>
            {canBoot && (
              <Button
                disabled={booting}
                leading={<Icons.BootIcon size={11} />}
                variant="secondary"
                onClick={handleBoot}
              >
                {booting ? "Booting..." : "Boot"}
              </Button>
            )}
            {canShutdown && (
              <Button
                disabled={shuttingDown}
                leading={<Icons.DisconnectIcon size={11} />}
                variant="danger"
                onClick={handleShutdown}
              >
                {shuttingDown ? "Shutting down..." : "Shut down"}
              </Button>
            )}
            {canPopout && (
              <Button
                leading={<Icons.PopoutIcon size={11} />}
                variant="secondary"
                onClick={handlePopout}
              >
                Open floating window
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}
