/**
 * VS Code services initialization for monaco-vscode-api (views mode).
 *
 * Replaces the old monacoSetup.ts. Must be imported and awaited before
 * any editor component renders.
 */

import { initialize, getService, IContextKeyService } from "@codingame/monaco-vscode-api";
import getConfigurationServiceOverride, {
  initUserConfiguration,
} from "@codingame/monaco-vscode-configuration-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getViewsServiceOverride, {
  Parts,
  attachPart,
  isPartVisibile,
  onPartVisibilityChange,
  setPartVisibility,
} from "@codingame/monaco-vscode-views-service-override";
import getQuickAccessServiceOverride from "@codingame/monaco-vscode-quickaccess-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getNotificationsServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import getDialogsServiceOverride from "@codingame/monaco-vscode-dialogs-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import getExtensionsServiceOverride from "@codingame/monaco-vscode-extensions-service-override";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";
import getMarkersServiceOverride from "@codingame/monaco-vscode-markers-service-override";
import getOutlineServiceOverride from "@codingame/monaco-vscode-outline-service-override";
import getSnippetsServiceOverride from "@codingame/monaco-vscode-snippets-service-override";
import getEmmetServiceOverride from "@codingame/monaco-vscode-emmet-service-override";
import getDebugServiceOverride from "@codingame/monaco-vscode-debug-service-override";
import getPreferencesServiceOverride from "@codingame/monaco-vscode-preferences-service-override";
import getAccessibilityServiceOverride from "@codingame/monaco-vscode-accessibility-service-override";
import getLanguageDetectionWorkerServiceOverride from "@codingame/monaco-vscode-language-detection-worker-service-override";
import getStorageServiceOverride from "@codingame/monaco-vscode-storage-service-override";
import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
import getEnvironmentServiceOverride from "@codingame/monaco-vscode-environment-service-override";
import getWorkspaceTrustServiceOverride from "@codingame/monaco-vscode-workspace-trust-service-override";
import getLogServiceOverride from "@codingame/monaco-vscode-log-service-override";
import getWorkingCopyServiceOverride from "@codingame/monaco-vscode-working-copy-service-override";
import getOutputServiceOverride from "@codingame/monaco-vscode-output-service-override";
import getViewBannerServiceOverride from "@codingame/monaco-vscode-view-banner-service-override";
import getViewStatusBarServiceOverride from "@codingame/monaco-vscode-view-status-bar-service-override";
import getViewTitleBarServiceOverride from "@codingame/monaco-vscode-view-title-bar-service-override";
import getTestingServiceOverride from "@codingame/monaco-vscode-testing-service-override";
import getNotebookServiceOverride from "@codingame/monaco-vscode-notebook-service-override";
import getWelcomeServiceOverride from "@codingame/monaco-vscode-welcome-service-override";
import getWalkthroughServiceOverride from "@codingame/monaco-vscode-walkthrough-service-override";
import getUserDataSyncServiceOverride from "@codingame/monaco-vscode-user-data-sync-service-override";
import getUserDataProfileServiceOverride from "@codingame/monaco-vscode-user-data-profile-service-override";
import getTaskServiceOverride from "@codingame/monaco-vscode-task-service-override";
import getTimelineServiceOverride from "@codingame/monaco-vscode-timeline-service-override";
import getCommentsServiceOverride from "@codingame/monaco-vscode-comments-service-override";
import getEditSessionsServiceOverride from "@codingame/monaco-vscode-edit-sessions-service-override";
import getInteractiveServiceOverride from "@codingame/monaco-vscode-interactive-service-override";
import getMultiDiffEditorServiceOverride from "@codingame/monaco-vscode-multi-diff-editor-service-override";
import getPerformanceServiceOverride from "@codingame/monaco-vscode-performance-service-override";
import getLocalizationServiceOverride from "@codingame/monaco-vscode-localization-service-override";
import getTreesitterServiceOverride from "@codingame/monaco-vscode-treesitter-service-override";
import getTelemetryServiceOverride from "@codingame/monaco-vscode-telemetry-service-override";
import getSecretStorageServiceOverride from "@codingame/monaco-vscode-secret-storage-service-override";
import getExtensionGalleryServiceOverride from "@codingame/monaco-vscode-extension-gallery-service-override";

// Import language extensions (triggers TextMate grammar registration)
import "./vscodeExtensions";

import { registerIpcFilesystem } from "./vscodeFilesystem";
import { loadLocalExtensions } from "./vscodeLocalExtensions";

// Worker URL imports — Vite resolves these at build time via import.meta.url
const editorWorkerUrl = new URL(
  "monaco-editor/esm/vs/editor/editor.worker.js",
  import.meta.url,
);
const textMateWorkerUrl = new URL(
  "@codingame/monaco-vscode-textmate-service-override/worker",
  import.meta.url,
);
const outputLinkDetectionWorkerUrl = new URL(
  "@codingame/monaco-vscode-output-service-override/worker",
  import.meta.url,
);
const languageDetectionWorkerUrl = new URL(
  "@codingame/monaco-vscode-language-detection-worker-service-override/worker",
  import.meta.url,
);
const extensionHostWorkerUrl = new URL(
  "@codingame/monaco-vscode-extensions-service-override/worker",
  import.meta.url,
);

// Configure the MonacoEnvironment workers
declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker(moduleId: string, label: string): Worker;
    };
  }
}

window.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case "editorWorkerService":
        return new Worker(editorWorkerUrl, { type: "module" });
      case "textMateWorker":
        return new Worker(textMateWorkerUrl, { type: "module" });
      case "outputLinkDetection":
        return new Worker(outputLinkDetectionWorkerUrl, { type: "module" });
      case "languageDetectionWorkerService":
        return new Worker(languageDetectionWorkerUrl, { type: "module" });
      case "workerExtensionHost":
        return new Worker(extensionHostWorkerUrl, { type: "module" });
      default:
        return new Worker(editorWorkerUrl, { type: "module" });
    }
  },
};

// ---------------------------------------------------------------------------
// Stagehand theme — applied as user configuration before services initialize.
//
// Maps Stagehand's CSS palette (global.css :root vars) onto VS Code's
// workbench color tokens so the editor, explorer, status bar, etc. all
// match the surrounding Stagehand shell.
//
// Palette reference:
//   --bg-primary:   #141418    --text-primary:   #e8e8e8
//   --bg-secondary: #1a1a1e    --text-secondary: #a0a0b0
//   --bg-tertiary:  #1e1e24    --text-muted:     #606070
//   --bg-hover:     #2a2a32    --accent:         #10b981
//   --border:       #252530    --accent-hover:   #34d399
//   --error:        #ef4444    --warning:        #f59e0b
//   --success:      #10b981
// ---------------------------------------------------------------------------
const stagehandUserConfig = JSON.stringify({
  // Force our base theme and disable theme picker
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.preferredDarkColorTheme": "Default Dark Modern",

  // Hide the native activity bar — replaced by custom SidebarHeader component
  "workbench.activityBar.location": "hidden",

  // Hide the hamburger menu button
  "window.menuBarVisibility": "hidden",

  // Hide accounts/manage buttons — Stagehand handles these outside the editor
  "workbench.activity.showAccounts": false,

  // Show open editors at top of explorer sidebar (Cursor-style)
  "explorer.openEditors.visible": 10,

  // Don't restore previous editors — workspace changes between sessions
  // and stale file URIs cause "file not found" errors
  "workbench.editor.restoreViewState": false,
  "workbench.startupEditor": "none",

  // Override every significant workbench color to match the Stagehand palette
  "workbench.colorCustomizations": {
    // Editor
    "editor.background": "#141418",
    "editor.foreground": "#e8e8e8",
    "editor.lineHighlightBackground": "#1e1e24",
    "editor.selectionBackground": "#10b98140",
    "editor.inactiveSelectionBackground": "#10b98120",
    "editorCursor.foreground": "#10b981",
    "editorLineNumber.foreground": "#606070",
    "editorLineNumber.activeForeground": "#a0a0b0",
    "editorIndentGuide.background": "#252530",
    "editorIndentGuide.activeBackground": "#2a2a32",
    "editorWidget.background": "#1a1a1e",
    "editorWidget.border": "#252530",
    "editorBracketMatch.border": "#10b98180",
    "editorBracketMatch.background": "#10b98118",
    "editorGutter.background": "#141418",
    "editorOverviewRuler.border": "#252530",
    "editorGroup.border": "#252530",
    "editorGroupHeader.tabsBackground": "#1a1a1e",
    "editorGroupHeader.tabsBorder": "#252530",

    // Tabs
    "tab.activeBackground": "#141418",
    "tab.activeForeground": "#e8e8e8",
    "tab.activeBorderTop": "#10b981",
    "tab.inactiveBackground": "#1a1a1e",
    "tab.inactiveForeground": "#606070",
    "tab.border": "#252530",
    "tab.hoverBackground": "#2a2a32",

    // Activity bar
    "activityBar.background": "#141418",
    "activityBar.foreground": "#e8e8e8",
    "activityBar.inactiveForeground": "#606070",
    "activityBar.border": "#252530",
    "activityBarBadge.background": "#10b981",
    "activityBarBadge.foreground": "#ffffff",

    // Sidebar (explorer, search, etc.)
    "sideBar.background": "#1a1a1e",
    "sideBar.foreground": "#a0a0b0",
    "sideBar.border": "#252530",
    "sideBarTitle.foreground": "#e8e8e8",
    "sideBarSectionHeader.background": "#1a1a1e",
    "sideBarSectionHeader.foreground": "#a0a0b0",
    "sideBarSectionHeader.border": "#252530",

    // Lists (file tree, search results, etc.)
    "list.activeSelectionBackground": "#10b98120",
    "list.activeSelectionForeground": "#e8e8e8",
    "list.inactiveSelectionBackground": "#2a2a32",
    "list.inactiveSelectionForeground": "#e8e8e8",
    "list.hoverBackground": "#2a2a32",
    "list.hoverForeground": "#e8e8e8",
    "list.focusOutline": "#10b98180",
    "list.highlightForeground": "#10b981",

    // Status bar
    "statusBar.background": "#141418",
    "statusBar.foreground": "#606070",
    "statusBar.border": "#252530",
    "statusBar.noFolderBackground": "#141418",
    "statusBarItem.hoverBackground": "#2a2a32",
    "statusBarItem.activeBackground": "#2a2a32",

    // Title bar
    "titleBar.activeBackground": "#141418",
    "titleBar.activeForeground": "#e8e8e8",
    "titleBar.inactiveBackground": "#141418",
    "titleBar.inactiveForeground": "#606070",
    "titleBar.border": "#252530",

    // Panel (problems, output, terminal)
    "panel.background": "#141418",
    "panel.border": "#252530",
    "panelTitle.activeBorder": "#10b981",
    "panelTitle.activeForeground": "#e8e8e8",
    "panelTitle.inactiveForeground": "#606070",

    // Input controls
    "input.background": "#1e1e24",
    "input.foreground": "#e8e8e8",
    "input.border": "#252530",
    "input.placeholderForeground": "#606070",
    "inputOption.activeBorder": "#10b981",
    "inputOption.activeBackground": "#10b98130",
    "focusBorder": "#10b981",

    // Buttons
    "button.background": "#10b981",
    "button.foreground": "#ffffff",
    "button.hoverBackground": "#34d399",

    // Dropdown
    "dropdown.background": "#1a1a1e",
    "dropdown.foreground": "#e8e8e8",
    "dropdown.border": "#252530",

    // Badges
    "badge.background": "#10b981",
    "badge.foreground": "#ffffff",

    // Scrollbar
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#2a2a3280",
    "scrollbarSlider.hoverBackground": "#60607080",
    "scrollbarSlider.activeBackground": "#60607080",

    // Minimap
    "minimap.background": "#141418",

    // Breadcrumbs
    "breadcrumb.foreground": "#606070",
    "breadcrumb.focusForeground": "#e8e8e8",
    "breadcrumb.activeSelectionForeground": "#e8e8e8",
    "breadcrumbPicker.background": "#1a1a1e",

    // Notifications
    "notifications.background": "#1a1a1e",
    "notifications.foreground": "#e8e8e8",
    "notifications.border": "#252530",
    "notificationCenterHeader.background": "#1a1a1e",

    // Quick input (command palette)
    "quickInput.background": "#1a1a1e",
    "quickInput.foreground": "#e8e8e8",
    "quickInputList.focusBackground": "#2a2a32",
    "quickInputTitle.background": "#1a1a1e",

    // Peek view
    "peekView.border": "#10b981",
    "peekViewEditor.background": "#141418",
    "peekViewResult.background": "#1a1a1e",
    "peekViewTitle.background": "#1a1a1e",

    // Diff editor
    "diffEditor.insertedTextBackground": "#10b98118",
    "diffEditor.removedTextBackground": "#ef444418",

    // Git decorations
    "gitDecoration.modifiedResourceForeground": "#f59e0b",
    "gitDecoration.untrackedResourceForeground": "#10b981",
    "gitDecoration.deletedResourceForeground": "#ef4444",
    "gitDecoration.conflictingResourceForeground": "#ef4444",
    "gitDecoration.ignoredResourceForeground": "#606070",

    // Error / warning / info
    "editorError.foreground": "#ef4444",
    "editorWarning.foreground": "#f59e0b",
    "editorInfo.foreground": "#10b981",

    // Selection highlight
    "editor.wordHighlightBackground": "#10b98118",
    "editor.wordHighlightStrongBackground": "#10b98128",
    "editor.findMatchBackground": "#f59e0b40",
    "editor.findMatchHighlightBackground": "#f59e0b20",
  },

  // Editor settings matching the old MonacoWrapper options
  "editor.fontSize": 13,
  "editor.fontFamily": "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  "editor.lineHeight": 20,
  "editor.minimap.enabled": true,
  "editor.minimap.scale": 1,
  "editor.minimap.maxColumn": 80,
  "editor.scrollBeyondLastLine": false,
  "editor.smoothScrolling": true,
  "editor.cursorSmoothCaretAnimation": "on",
  "editor.cursorBlinking": "smooth",
  "editor.renderLineHighlight": "line",
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.indentation": true,
  "editor.guides.bracketPairs": true,
  "editor.padding.top": 4,
  "editor.padding.bottom": 4,
  "editor.tabSize": 2,
  "editor.wordWrap": "off",
  "editor.fixedOverflowWidgets": true,
  "editor.scrollbar.verticalScrollbarSize": 10,
  "editor.scrollbar.horizontalScrollbarSize": 10,
  "editor.scrollbar.useShadows": false,
  "editor.overviewRulerBorder": false,
  "editor.hideCursorInOverviewRuler": true,
  "editor.renderWhitespace": "none",
  "editor.occurrencesHighlight": "singleFile",
  "editor.selectionHighlight": true,
  "editor.matchBrackets": "always",
});

/**
 * Initialize all VS Code services. This must complete before any editor
 * component is rendered.
 */
export const vscodeReady = (async () => {
  // Inject Stagehand theme settings before the configuration service starts
  await initUserConfiguration(stagehandUserConfig);

  await initialize(
  {
    ...getConfigurationServiceOverride(),
    ...getKeybindingsServiceOverride(),
    ...getFilesServiceOverride(),
    ...getViewsServiceOverride(undefined, undefined, false),
    ...getQuickAccessServiceOverride(),
    ...getModelServiceOverride(),
    ...getNotificationsServiceOverride(),
    ...getDialogsServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getExtensionsServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getSearchServiceOverride(),
    ...getMarkersServiceOverride(),
    ...getOutlineServiceOverride(),
    ...getSnippetsServiceOverride(),
    ...getEmmetServiceOverride(),
    ...getDebugServiceOverride(),
    ...getPreferencesServiceOverride(),
    ...getAccessibilityServiceOverride(),
    ...getLanguageDetectionWorkerServiceOverride(),
    ...getStorageServiceOverride(),
    ...getLifecycleServiceOverride(),
    ...getEnvironmentServiceOverride(),
    ...getWorkspaceTrustServiceOverride(),
    ...getLogServiceOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getOutputServiceOverride(),
    ...getViewBannerServiceOverride(),
    ...getViewStatusBarServiceOverride(),
    ...getViewTitleBarServiceOverride(),
    ...getTestingServiceOverride(),
    ...getNotebookServiceOverride(),
    ...getWelcomeServiceOverride(),
    ...getWalkthroughServiceOverride(),
    ...getUserDataSyncServiceOverride(),
    ...getUserDataProfileServiceOverride(),
    ...getTaskServiceOverride(),
    ...getTimelineServiceOverride(),
    ...getCommentsServiceOverride(),
    ...getEditSessionsServiceOverride(),
    ...getInteractiveServiceOverride(),
    ...getMultiDiffEditorServiceOverride(),
    ...getPerformanceServiceOverride(),
    ...getLocalizationServiceOverride({
      async setLocale() {},
      async clearLocale() {},
      availableLanguages: [{ locale: "en" }],
    }),
    ...getTreesitterServiceOverride(),
    ...getTelemetryServiceOverride(),
    ...getSecretStorageServiceOverride(),
    ...getExtensionGalleryServiceOverride(),
  },
  document.body,
  {
    workspaceProvider: {
      trusted: true,
      async open() {
        return false;
      },
      workspace: undefined,
    },
    productConfiguration: {
      nameShort: "Stagehand",
      nameLong: "Stagehand IDE",
      extensionsGallery: {
        serviceUrl: "https://open-vsx.org/vscode/gallery",
        controlUrl: "",
        extensionUrlTemplate:
          "https://open-vsx.org/vscode/item?itemName={publisher}.{name}",
        resourceUrlTemplate:
          "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
        nlsBaseUrl: "",
      },
    },
    defaultLayout: {
      views: [{ id: "workbench.explorer.fileView" }],
      force: true,
    },
  },
  );

  // Register the IPC filesystem overlay so VS Code reads/writes via Electron
  registerIpcFilesystem();

  // Load extensions from ~/.cursor/extensions/ and ~/.vscode/extensions/
  loadLocalExtensions();

  // After services are ready, disable "Open Folder" commands.
  // Stagehand controls workspace switching via its own sidebar — users
  // should not be able to change the open folder from within VS Code.
  try {
    const contextKeyService = await getService(IContextKeyService);
    // Setting this context key to false hides the "Open Folder" entries
    // from menus that gate on `workbenchStateContext` or `openFolderWorkspaceSupport`
    contextKeyService.createKey("openFolderWorkspaceSupport", false);
  } catch {
    // Non-fatal — commands just remain visible but return false from workspaceProvider.open
  }

})();

// Re-export parts API for use by EditorPanel
export { Parts, attachPart, isPartVisibile, onPartVisibilityChange, setPartVisibility };
