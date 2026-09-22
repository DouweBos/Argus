import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import { useDeviceVideo } from "../../../hooks/useDeviceVideo";
import chrome from "../RuntimeChrome.module.css";
import { RuntimeTitleBar } from "../RuntimeTitleBar";
import { type StreamRotation, CanvasStreamBody } from "./CanvasStreamBody";
import styles from "./RuntimeView.module.css";

interface StreamRenderProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isConfigured: boolean;
  isReceiving: boolean;
  rotation: StreamRotation;
  videoHeight: number;
  videoWidth: number;
}

export interface IosDeviceStreamViewProps {
  /** Hardware / session controls rendered in the floating bar below the title row. */
  actionButtons: React.ReactNode;
  capturing: boolean;
  /** Platform toggle, rendered at the start of the title bar. */
  children?: React.ReactNode;
  /** Host-side input arbitration for this device. */
  claim?: DeviceClaimState;
  devicePicker: React.ReactNode;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called with normalized [0..1] coordinates and event type (0=down, 1=move, 2=up). */
  onTouch: (x: number, y: number, eventType: number) => void;
  placeholder: React.ReactNode;
  /** Override the default stream body (e.g. tvOS side-by-side remote layout). */
  renderStream?: (props: StreamRenderProps) => React.ReactNode;
  /** Clockwise rotation the panel's contents need to sit upright. */
  rotation?: StreamRotation;
  /**
   * When false, the floating bar is hidden. When true but the device session is
   * idle, the bar can still show session actions such as Run (see simulator
   * views). Use `titleBarExtra` for boot controls on the title row when idle.
   */
  showFloatingActionBar?: boolean;
  /** Trailing controls on the title row (e.g. boot when idle). */
  titleBarExtra?: React.ReactNode;
  /** Toggles pinned to the far right of the title bar (e.g. expand, popout). */
  titleBarToggles?: React.ReactNode;
  toolsAvailable: boolean | null;
  toolsMissing: { body: React.ReactNode; title: string };
  /** UDID of the device being streamed — scopes the per-device video channel. */
  udid: string | null;
}

/**
 * iOS/tvOS device stream. Decodes the bridge's hardware H.264 stream with
 * WebCodecs and renders to a canvas — the same path as {@link
 * AndroidDeviceStreamView}. Touch/keyboard input still flows over the JSON
 * bridge via the `onTouch`/`onKey*` callbacks.
 */
export function IosDeviceStreamView({
  actionButtons,
  capturing,
  children,
  claim,
  devicePicker,
  placeholder,
  showFloatingActionBar = true,
  titleBarExtra,
  titleBarToggles,
  toolsAvailable,
  toolsMissing,
  renderStream,
  rotation = 0,
  udid,
  onKeyDown,
  onKeyUp,
  onTouch,
}: IosDeviceStreamViewProps) {
  const { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight } =
    useDeviceVideo(capturing, udid, "ios");

  const titleChrome = (
    <RuntimeTitleBar
      actionBar={actionButtons}
      picker={devicePicker}
      showActionBar={showFloatingActionBar}
      spacedActionBar
      toggles={titleBarToggles}
      trailing={titleBarExtra}
    >
      {children}
    </RuntimeTitleBar>
  );

  if (toolsAvailable === false) {
    return (
      <>
        <RuntimeTitleBar toggles={titleBarToggles}>{children}</RuntimeTitleBar>
        <div className={chrome.placeholder}>
          <div className={styles.toolsMissingHint}>
            <p className={styles.toolsMissingTitle}>{toolsMissing.title}</p>
            {toolsMissing.body}
          </div>
        </div>
      </>
    );
  }

  if (!capturing) {
    return (
      <>
        {titleChrome}
        <div className={chrome.placeholder}>{placeholder}</div>
      </>
    );
  }

  if (renderStream) {
    return (
      <>
        {titleChrome}
        {renderStream({
          canvasRef,
          isReceiving,
          isConfigured,
          rotation,
          videoWidth,
          videoHeight,
        })}
      </>
    );
  }

  return (
    <>
      {titleChrome}
      <CanvasStreamBody
        canvasRef={canvasRef}
        claim={claim}
        deviceKey={udid}
        isConfigured={isConfigured}
        isReceiving={isReceiving}
        rotation={rotation}
        videoHeight={videoHeight}
        videoWidth={videoWidth}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onTouch={onTouch}
      />
    </>
  );
}
