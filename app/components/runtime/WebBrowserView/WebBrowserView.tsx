import type { ReactNode } from "react";
import { WebBrowserScaledWebview } from "./WebBrowserScaledWebview";
import { WebBrowserTitleBar } from "./WebBrowserTitleBar";
import styles from "./WebBrowserView.module.css";
import { useWebBrowserView } from "./useWebBrowserView";

interface WebBrowserViewProps {
  children?: ReactNode;
  isActive: boolean;
  sessionId: string | null;
  titleBarToggles?: ReactNode;
}

export function WebBrowserView({
  children,
  isActive,
  sessionId,
  titleBarToggles,
}: WebBrowserViewProps) {
  const {
    browserPreset,
    canGoBack,
    canGoForward,
    claim,
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
    setInputUrl,
  } = useWebBrowserView(sessionId, isActive);

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
      titleBarToggles={titleBarToggles}
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
          claim={claim}
          internalHeight={internalHeight}
          internalWidth={internalWidth}
          onKeyboardEvent={handleKeyboardEvent}
          onMouseEvent={handleMouseEvent}
          onWheelEvent={handleWheelEvent}
          sessionId={sessionId ?? "__global__"}
        />
      </div>
    </div>
  );
}
