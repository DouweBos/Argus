import { useVideoInputStream } from "../../../hooks/useVideoInputStream";
import { useSelectedVideoDeviceId } from "../../../stores/simulatorStore";
import { RuntimeTitleBar } from "../RuntimeTitleBar";
import styles from "./RuntimeView.module.css";

interface VideoInputViewProps {
  /** Platform toggle / device picker rendered at the start of the title bar. */
  children?: React.ReactNode;
  sessionId: string | null;
  /** Toggles pinned to the far right of the title row (expand, popout). */
  titleBarToggles?: React.ReactNode;
}

/**
 * View-only viewer for a connected video input (capture card / camera). The
 * device appears as a standard `videoinput` — we stream it straight to a
 * `<video>`. No control, just the live picture.
 */
export function VideoInputView({
  children,
  sessionId,
  titleBarToggles,
}: VideoInputViewProps) {
  const deviceId = useSelectedVideoDeviceId(sessionId);
  const { videoRef, playing, errorMsg } = useVideoInputStream(
    deviceId,
    deviceId !== null,
  );

  let overlay: string | null = null;
  if (!deviceId) {
    overlay = "Select a video input";
  } else if (errorMsg) {
    overlay = errorMsg;
  } else if (!playing) {
    overlay = "Starting video…";
  }

  return (
    <>
      <RuntimeTitleBar toggles={titleBarToggles}>{children}</RuntimeTitleBar>
      <div className={styles.streamBody}>
        <div className={styles.canvasContainer}>
          <video
            ref={videoRef}
            className={styles.video}
            autoPlay
            muted
            playsInline
          />
          {overlay !== null && (
            <div className={styles.connecting}>
              <p>{overlay}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
