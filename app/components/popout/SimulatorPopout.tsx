import { useEffect, useState } from "react";
import styles from "./SimulatorPopout.module.css";

interface SimulatorPopoutProps {
  deviceName: string;
  mjpegPort: number | null;
  udid: string;
}

/**
 * Minimal simulator view rendered inside the floating always-on-top popout
 * window. Subscribes to the same MJPEG stream (port served by the bridge
 * binary) as the main window, so no additional capture session is started.
 */
export function SimulatorPopout({
  mjpegPort,
  deviceName,
}: SimulatorPopoutProps) {
  const [cacheBust, setCacheBust] = useState(0);

  // If the main window tears down and re-creates the MJPEG session, the
  // existing stream URL may 404. Refresh once per second when the port is
  // missing so the popout recovers instead of staying blank forever.
  useEffect(() => {
    if (mjpegPort != null) {
      return;
    }
    const id = window.setInterval(() => setCacheBust((n) => n + 1), 1000);

    return () => window.clearInterval(id);
  }, [mjpegPort]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.name}>{deviceName}</span>
      </div>
      <div className={styles.body}>
        {mjpegPort != null ? (
          <img
            key={cacheBust}
            alt={deviceName}
            className={styles.canvas}
            draggable={false}
            src={`http://127.0.0.1:${mjpegPort}/stream.mjpg`}
          />
        ) : (
          <div className={styles.placeholder}>
            <p>No active capture for this simulator.</p>
          </div>
        )}
      </div>
    </div>
  );
}
