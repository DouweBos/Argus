import { useAndroidVideoDecoder } from "../../../hooks/useAndroidVideoDecoder";
import chrome from "../RuntimeChrome.module.css";
import { RuntimeTitleBar } from "../RuntimeTitleBar";
import { CanvasStreamBody } from "./CanvasStreamBody";
import styles from "./RuntimeView.module.css";

export interface AndroidDeviceStreamViewProps {
  /** Hardware / session controls rendered in the floating bar below the title row. */
  actionButtons: React.ReactNode;
  capturing: boolean;
  /** Platform toggle, rendered at the start of the title bar. */
  children?: React.ReactNode;
  devicePicker: React.ReactNode;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called with normalized [0..1] coordinates and event type (0=down, 1=move, 2=up). */
  onTouch: (x: number, y: number, eventType: number) => void;
  placeholder: React.ReactNode;
  /**
   * When false, the floating bar is hidden. When true but the device session is
   * idle, the bar can still show workspace actions such as Run (see simulator
   * views). Use `titleBarExtra` for boot controls on the title row when idle.
   */
  showFloatingActionBar?: boolean;
  /** Trailing controls on the title row (e.g. boot when idle). */
  titleBarExtra?: React.ReactNode;
  toolsAvailable: boolean | null;
  toolsMissing: { body: React.ReactNode; title: string };
}

export function AndroidDeviceStreamView({
  actionButtons,
  capturing,
  children,
  devicePicker,
  placeholder,
  showFloatingActionBar = true,
  titleBarExtra,
  toolsAvailable,
  toolsMissing,
  onKeyDown,
  onKeyUp,
  onTouch,
}: AndroidDeviceStreamViewProps) {
  const { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight } =
    useAndroidVideoDecoder(capturing);

  const titleChrome = (
    <RuntimeTitleBar
      actionBar={actionButtons}
      picker={devicePicker}
      showActionBar={showFloatingActionBar}
      spacedActionBar
      trailing={titleBarExtra}
    >
      {children}
    </RuntimeTitleBar>
  );

  if (toolsAvailable === false) {
    return (
      <>
        <RuntimeTitleBar>{children}</RuntimeTitleBar>
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

  return (
    <>
      {titleChrome}
      <CanvasStreamBody
        canvasRef={canvasRef}
        isConfigured={isConfigured}
        isReceiving={isReceiving}
        videoHeight={videoHeight}
        videoWidth={videoWidth}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onTouch={onTouch}
      />
    </>
  );
}
