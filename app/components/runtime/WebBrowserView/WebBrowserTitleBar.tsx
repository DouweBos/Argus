import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import {
  BROWSER_PRESETS,
  BUILTIN_PRESET_IDS,
  type BrowserPresetConfig,
} from "../../../lib/browserPresets";
import {
  ArrowBackIcon,
  ArrowForwardIcon,
  RefreshIcon,
} from "../../shared/Icons";
import chrome from "../RuntimeChrome.module.css";
import { RuntimeTitleBar } from "../RuntimeTitleBar";
import styles from "./WebBrowserView.module.css";

export interface WebBrowserTitleBarProps {
  browserPreset: string;
  canGoBack: boolean;
  canGoForward: boolean;
  children?: ReactNode;
  currentUrl: string;
  customPresets: BrowserPresetConfig[];
  inputUrl: string;
  onBack: () => void;
  onForward: () => void;
  onInputUrlChange: (value: string) => void;
  onPresetChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onReload: () => void;
  onUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function WebBrowserTitleBar({
  browserPreset,
  canGoBack,
  canGoForward,
  children,
  currentUrl,
  customPresets,
  inputUrl,
  onBack,
  onForward,
  onInputUrlChange,
  onPresetChange,
  onReload,
  onUrlKeyDown,
}: WebBrowserTitleBarProps) {
  const filteredCustomPresets = customPresets.filter(
    (p) => !BUILTIN_PRESET_IDS.includes(p.id),
  );

  const picker = (
    <select
      className={chrome.titleBarSelect}
      value={browserPreset}
      onChange={onPresetChange}
    >
      {BUILTIN_PRESET_IDS.map((presetId) => (
        <option key={presetId} value={presetId}>
          {BROWSER_PRESETS[presetId].label}
        </option>
      ))}
      {filteredCustomPresets.length > 0 && (
        <optgroup label="Custom">
          {filteredCustomPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label ?? p.id}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );

  const actionBar = (
    <>
      <div className={styles.floatingNavActions}>
        <button
          className={chrome.titleBarButton}
          disabled={!canGoBack}
          title="Back"
          type="button"
          onClick={onBack}
        >
          <ArrowBackIcon size={11} />
        </button>
        <button
          className={chrome.titleBarButton}
          disabled={!canGoForward}
          title="Forward"
          type="button"
          onClick={onForward}
        >
          <ArrowForwardIcon size={11} />
        </button>
      </div>
      <div className={styles.floatingNavUrlSlot}>
        <input
          className={styles.urlBar}
          placeholder="Enter URL..."
          spellCheck={false}
          type="text"
          value={inputUrl}
          onChange={(event) => onInputUrlChange(event.target.value)}
          onKeyDown={onUrlKeyDown}
        />
      </div>
      <button
        className={chrome.titleBarButton}
        disabled={!currentUrl}
        title="Reload"
        type="button"
        onClick={onReload}
      >
        <RefreshIcon size={11} />
      </button>
    </>
  );

  return (
    <RuntimeTitleBar actionBar={actionBar} picker={picker} showActionBar>
      {children}
    </RuntimeTitleBar>
  );
}
