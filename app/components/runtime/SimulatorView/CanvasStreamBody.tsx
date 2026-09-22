import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import type { StreamRotation } from "@argus/peacock";
import { useCallback } from "react";
import { DeviceControlOverlay, DeviceStage } from "@argus/peacock";
import { DeviceDriverBadge } from "@argus/peacock";
import { useSharedDeviceDrivers } from "../../../hooks/useSharedDeviceDrivers";
import styles from "./RuntimeView.module.css";

interface CanvasStreamBodyProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Input arbitration on the host. Omitted where nothing can contend for it. */
  claim?: DeviceClaimState;
  /**
   * The device this is a picture of, so a shared one can say who is driving.
   * Omitted where there is nothing to share (a preview, a test harness).
   */
  deviceKey?: string | null;
  /** Whether the decoder has received its H.264 config (SPS/PPS). */
  isConfigured: boolean;
  isReceiving: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onTouch: (x: number, y: number, eventType: number) => void;
  /** Clockwise rotation applied to the canvas; touches are un-rotated to match. */
  rotation?: StreamRotation;
  videoHeight: number;
  videoWidth: number;
}

/**
 * The runtime view's live device picture: Peacock's stage plus the desktop's
 * own overlays (claim scrim, driver badge, decode status).
 */
export function CanvasStreamBody({
  canvasRef,
  claim,
  deviceKey,
  videoWidth,
  videoHeight,
  isReceiving,
  isConfigured,
  onTouch,
  onKeyDown,
  onKeyUp,
  rotation = 0,
}: CanvasStreamBodyProps) {
  const blocked = claim?.blocked ?? false;
  const takeControl = claim?.takeControl;
  const drivers = useSharedDeviceDrivers(deviceKey ?? null);
  const handleTakeControl = useCallback(() => takeControl?.(), [takeControl]);

  return (
    <DeviceStage
      blocked={blocked}
      canvasRef={canvasRef}
      className={styles.streamBody}
      rotation={rotation}
      videoHeight={videoHeight}
      videoWidth={videoWidth}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onTouch={onTouch}
    >
      {claim && (
        <DeviceControlOverlay
          holderLabel={claim.holderLabel}
          onTakeControl={handleTakeControl}
        />
      )}
      {/* Awareness, not arbitration — this never blocks the pointer. */}
      <DeviceDriverBadge
        holderLabel={drivers.holderLabel}
        waitingLabels={drivers.waitingLabels}
      />
      {!isReceiving && (
        <div className={styles.connecting}>
          <p>
            {!isConfigured
              ? "Connecting to device..."
              : "Decoding first frame..."}
          </p>
        </div>
      )}
    </DeviceStage>
  );
}
