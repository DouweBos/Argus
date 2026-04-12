import type { ReactNode } from "react";
import { WebBrowserScaledWebview } from "./WebBrowserScaledWebview";
import { WebBrowserTitleBar } from "./WebBrowserTitleBar";
import styles from "./WebBrowserView.module.css";
import { useWebBrowserView } from "./useWebBrowserView";

interface WebBrowserViewProps {
  children?: ReactNode;
  isActive: boolean;
  workspaceId: string | null;
}

export function WebBrowserView({
  children,
  isActive,
  workspaceId,
}: WebBrowserViewProps) {
  const {
    browserPreset,
    canGoBack,
    canGoForward,
    currentUrl,
    customPresets,
    handleBack,
    handleForward,
    handleKeyboardEvent,
    handleMouseEvent,
    handlePresetChange,
    handleReload,
    handleUrlSubmit,
    handleWheelEvent,
    inputUrl,
    internalHeight,
    internalWidth,
    mjpegPort,
    setInputUrl,
  } = useWebBrowserView(workspaceId, isActive);

  const titleBar = (
    <WebBrowserTitleBar
      browserPreset={browserPreset}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      currentUrl={currentUrl}
      customPresets={customPresets}
      inputUrl={inputUrl}
      onBack={handleBack}
      onForward={handleForward}
      onInputUrlChange={setInputUrl}
      onPresetChange={handlePresetChange}
      onReload={handleReload}
      onUrlKeyDown={handleUrlSubmit}
    >
      {children}
    </WebBrowserTitleBar>
  );

  return (
    <div className={styles.browserInline}>
      {titleBar}
      <div className={styles.browserViewport}>
        <WebBrowserScaledWebview
          internalHeight={internalHeight}
          internalWidth={internalWidth}
          mjpegPort={mjpegPort}
          onKeyboardEvent={handleKeyboardEvent}
          onMouseEvent={handleMouseEvent}
          onWheelEvent={handleWheelEvent}
          workspaceId={workspaceId ?? "__global__"}
        />
      </div>
    </div>
  );
}
