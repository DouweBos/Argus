/**
 * VS Code services initialization for monaco-vscode-api (views mode).
 *
 * Replaces the old monacoSetup.ts. Must be imported and awaited before
 * any editor component renders.
 */

import getAccessibilityServiceOverride from "@codingame/monaco-vscode-accessibility-service-override";
import {
  IContextKeyService,
  getService,
  initialize,
} from "@codingame/monaco-vscode-api";
import getCommentsServiceOverride from "@codingame/monaco-vscode-comments-service-override";
import getConfigurationServiceOverride, {
  initUserConfiguration,
} from "@codingame/monaco-vscode-configuration-service-override";
import getDebugServiceOverride from "@codingame/monaco-vscode-debug-service-override";
import getDialogsServiceOverride from "@codingame/monaco-vscode-dialogs-service-override";
import getEditSessionsServiceOverride from "@codingame/monaco-vscode-edit-sessions-service-override";
import getEmmetServiceOverride from "@codingame/monaco-vscode-emmet-service-override";
import getEnvironmentServiceOverride from "@codingame/monaco-vscode-environment-service-override";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getExtensionGalleryServiceOverride from "@codingame/monaco-vscode-extension-gallery-service-override";
import getExtensionsServiceOverride from "@codingame/monaco-vscode-extensions-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getInteractiveServiceOverride from "@codingame/monaco-vscode-interactive-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getLanguageDetectionWorkerServiceOverride from "@codingame/monaco-vscode-language-detection-worker-service-override";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
import getLocalizationServiceOverride from "@codingame/monaco-vscode-localization-service-override";
import getLogServiceOverride from "@codingame/monaco-vscode-log-service-override";
import getMarkersServiceOverride from "@codingame/monaco-vscode-markers-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getMultiDiffEditorServiceOverride from "@codingame/monaco-vscode-multi-diff-editor-service-override";
import getNotebookServiceOverride from "@codingame/monaco-vscode-notebook-service-override";
import getNotificationsServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import getOutlineServiceOverride from "@codingame/monaco-vscode-outline-service-override";
import getOutputServiceOverride from "@codingame/monaco-vscode-output-service-override";
import getPerformanceServiceOverride from "@codingame/monaco-vscode-performance-service-override";
import getPreferencesServiceOverride from "@codingame/monaco-vscode-preferences-service-override";
import getQuickAccessServiceOverride from "@codingame/monaco-vscode-quickaccess-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";
import getSecretStorageServiceOverride from "@codingame/monaco-vscode-secret-storage-service-override";
import getSnippetsServiceOverride from "@codingame/monaco-vscode-snippets-service-override";
import getStorageServiceOverride from "@codingame/monaco-vscode-storage-service-override";
import getTaskServiceOverride from "@codingame/monaco-vscode-task-service-override";
import getTelemetryServiceOverride from "@codingame/monaco-vscode-telemetry-service-override";
import getTestingServiceOverride from "@codingame/monaco-vscode-testing-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getTimelineServiceOverride from "@codingame/monaco-vscode-timeline-service-override";
import getTreesitterServiceOverride from "@codingame/monaco-vscode-treesitter-service-override";
import getUserDataProfileServiceOverride from "@codingame/monaco-vscode-user-data-profile-service-override";
import getUserDataSyncServiceOverride from "@codingame/monaco-vscode-user-data-sync-service-override";
import getViewBannerServiceOverride from "@codingame/monaco-vscode-view-banner-service-override";
import getViewStatusBarServiceOverride from "@codingame/monaco-vscode-view-status-bar-service-override";
import getViewTitleBarServiceOverride from "@codingame/monaco-vscode-view-title-bar-service-override";
import getViewsServiceOverride, {
  Parts,
  attachPart,
  isPartVisibile,
  onPartVisibilityChange,
  setPartVisibility,
} from "@codingame/monaco-vscode-views-service-override";
import getWalkthroughServiceOverride from "@codingame/monaco-vscode-walkthrough-service-override";
import getWelcomeServiceOverride from "@codingame/monaco-vscode-welcome-service-override";
import getWorkingCopyServiceOverride from "@codingame/monaco-vscode-working-copy-service-override";
import getWorkspaceTrustServiceOverride from "@codingame/monaco-vscode-workspace-trust-service-override";
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
      getWorker: (moduleId: string, label: string) => Worker;
    };
  }
}

window.MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) => {
    // [syntax-highlight-debug] Worker spawning is a prerequisite for TextMate
    // tokenization — if textMateWorker or workerExtensionHost fails to start,
    // grammars never register and the editor renders as plain text.
    const mkWorker = (url: URL, name: string) => {
      try {
        const w = new Worker(url, { type: "module" });
        console.log(
          `[syntax-highlight-debug] spawned worker "${label}" (${name}) url=${url.href}`,
        );
        w.addEventListener("error", (e) => {
          console.error(
            `[syntax-highlight-debug] worker "${label}" (${name}) runtime error`,
            e.message,
            e.filename,
            e.lineno,
            e,
          );
        });
        w.addEventListener("messageerror", (e) => {
          console.error(
            `[syntax-highlight-debug] worker "${label}" (${name}) messageerror`,
            e,
          );
        });

        return w;
      } catch (err) {
        console.error(
          `[syntax-highlight-debug] FAILED to spawn worker "${label}" (${name}) url=${url.href}`,
          err,
        );
        throw err;
      }
    };
    switch (label) {
      case "editorWorkerService":
        return mkWorker(editorWorkerUrl, "editor");
      case "textMateWorker":
        return mkWorker(textMateWorkerUrl, "textmate");
      case "outputLinkDetection":
        return mkWorker(outputLinkDetectionWorkerUrl, "output-link");
      case "languageDetectionWorkerService":
        return mkWorker(languageDetectionWorkerUrl, "language-detection");
      case "workerExtensionHost":
        return mkWorker(extensionHostWorkerUrl, "extension-host");
      default:
        console.warn(
          `[syntax-highlight-debug] unknown worker label "${label}" — falling back to editor worker`,
        );

        return mkWorker(editorWorkerUrl, "editor-fallback");
    }
  },
};

// ---------------------------------------------------------------------------
// Argus theme — applied as user configuration before services initialize.
//
// Maps Argus's CSS palette (global.css :root vars) onto VS Code's
// workbench color tokens so the editor, explorer, status bar, etc. all
// match the surrounding Argus shell.
//
// Palette reference (keep in sync with global.css):
//   --bg-primary:   #0a0a0f    --text-primary:   #f0f0f5
//   --bg-secondary: #111118    --text-secondary: #a0a0b8
//   --bg-tertiary:  #1a1a24    --text-muted:     #55556a
//   --bg-hover:     #222233    --accent:         #4d9fff
//   --border:       rgba(255,255,255,0.08) ≈ #15151d on #0a0a0f
//   --error:        #ff4466    --warning:        #f5a623
//   --success:      #00d4aa
// ---------------------------------------------------------------------------
const BORDER = "#1c1c28"; // Solid approximation of rgba(255,255,255,0.08) on bg-primary

const argusUserConfig = JSON.stringify({
  // Force our base theme and disable theme picker
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.preferredDarkColorTheme": "Default Dark Modern",

  // Hide the native activity bar — replaced by custom SidebarHeader component
  "workbench.activityBar.location": "hidden",

  // Hide the hamburger menu button
  "window.menuBarVisibility": "hidden",

  // Hide accounts/manage buttons — Argus handles these outside the editor
  "workbench.activity.showAccounts": false,

  // Show open editors at top of explorer sidebar (Cursor-style)
  "explorer.openEditors.visible": 10,

  // Don't restore previous editors — workspace changes between sessions
  // and stale file URIs cause "file not found" errors
  "workbench.editor.restoreViewState": false,
  "workbench.startupEditor": "none",

  // Override every significant workbench color to match the Argus palette
  "workbench.colorCustomizations": {
    // Editor
    "editor.background": "#0a0a0f",
    "editor.foreground": "#f0f0f5",
    "editor.lineHighlightBackground": "#1a1a24",
    "editor.selectionBackground": "#4d9fff40",
    "editor.inactiveSelectionBackground": "#4d9fff20",
    "editorCursor.foreground": "#4d9fff",
    "editorLineNumber.foreground": "#55556a",
    "editorLineNumber.activeForeground": "#a0a0b8",
    "editorIndentGuide.background": BORDER,
    "editorIndentGuide.activeBackground": "#222233",
    "editorWidget.background": "#111118",
    "editorWidget.border": BORDER,
    "editorBracketMatch.border": "#4d9fff80",
    "editorBracketMatch.background": "#4d9fff18",
    "editorGutter.background": "#0a0a0f",
    "editorOverviewRuler.border": BORDER,
    "editorGroup.border": BORDER,
    "editorGroupHeader.tabsBackground": "#111118",
    "editorGroupHeader.tabsBorder": BORDER,

    // Tabs
    "tab.activeBackground": "#0a0a0f",
    "tab.activeForeground": "#f0f0f5",
    "tab.activeBorderTop": "#4d9fff",
    "tab.inactiveBackground": "#111118",
    "tab.inactiveForeground": "#55556a",
    "tab.border": BORDER,
    "tab.hoverBackground": "#222233",

    // Activity bar (hidden, but keep colors for consistency)
    "activityBar.background": "#0a0a0f",
    "activityBar.foreground": "#f0f0f5",
    "activityBar.inactiveForeground": "#55556a",
    "activityBar.border": BORDER,
    "activityBarBadge.background": "#4d9fff",
    "activityBarBadge.foreground": "#0a0a0f",

    // Sidebar (explorer, search, etc.)
    "sideBar.background": "#111118",
    "sideBar.foreground": "#a0a0b8",
    "sideBar.border": BORDER,
    "sideBarTitle.foreground": "#f0f0f5",
    "sideBarSectionHeader.background": "#111118",
    "sideBarSectionHeader.foreground": "#a0a0b8",
    "sideBarSectionHeader.border": BORDER,

    // Lists (file tree, search results, etc.)
    "list.activeSelectionBackground": "#4d9fff20",
    "list.activeSelectionForeground": "#f0f0f5",
    "list.inactiveSelectionBackground": "#222233",
    "list.inactiveSelectionForeground": "#f0f0f5",
    "list.hoverBackground": "#222233",
    "list.hoverForeground": "#f0f0f5",
    "list.focusOutline": "#4d9fff80",
    "list.highlightForeground": "#4d9fff",

    // Status bar
    "statusBar.background": "#0a0a0f",
    "statusBar.foreground": "#55556a",
    "statusBar.border": BORDER,
    "statusBar.noFolderBackground": "#0a0a0f",
    "statusBarItem.hoverBackground": "#222233",
    "statusBarItem.activeBackground": "#222233",

    // Title bar
    "titleBar.activeBackground": "#0a0a0f",
    "titleBar.activeForeground": "#f0f0f5",
    "titleBar.inactiveBackground": "#0a0a0f",
    "titleBar.inactiveForeground": "#55556a",
    "titleBar.border": BORDER,

    // Panel (problems, output, terminal)
    "panel.background": "#0a0a0f",
    "panel.border": BORDER,
    "panelTitle.activeBorder": "#4d9fff",
    "panelTitle.activeForeground": "#f0f0f5",
    "panelTitle.inactiveForeground": "#55556a",

    // Input controls
    "input.background": "#1a1a24",
    "input.foreground": "#f0f0f5",
    "input.border": BORDER,
    "input.placeholderForeground": "#55556a",
    "inputOption.activeBorder": "#4d9fff",
    "inputOption.activeBackground": "#4d9fff30",
    focusBorder: "#4d9fff",

    // Buttons
    "button.background": "#4d9fff",
    "button.foreground": "#0a0a0f",
    "button.hoverBackground": "#70b3ff",

    // Dropdown
    "dropdown.background": "#111118",
    "dropdown.foreground": "#f0f0f5",
    "dropdown.border": BORDER,

    // Badges
    "badge.background": "#4d9fff",
    "badge.foreground": "#0a0a0f",

    // Scrollbar
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#22223380",
    "scrollbarSlider.hoverBackground": "#55556a80",
    "scrollbarSlider.activeBackground": "#55556a80",

    // Minimap
    "minimap.background": "#0a0a0f",

    // Breadcrumbs
    "breadcrumb.foreground": "#55556a",
    "breadcrumb.focusForeground": "#f0f0f5",
    "breadcrumb.activeSelectionForeground": "#f0f0f5",
    "breadcrumbPicker.background": "#111118",

    // Notifications
    "notifications.background": "#111118",
    "notifications.foreground": "#f0f0f5",
    "notifications.border": BORDER,
    "notificationCenterHeader.background": "#111118",

    // Quick input (command palette)
    "quickInput.background": "#111118",
    "quickInput.foreground": "#f0f0f5",
    "quickInputList.focusBackground": "#222233",
    "quickInputTitle.background": "#111118",

    // Peek view
    "peekView.border": "#4d9fff",
    "peekViewEditor.background": "#0a0a0f",
    "peekViewResult.background": "#111118",
    "peekViewTitle.background": "#111118",

    // Diff editor
    "diffEditor.insertedTextBackground": "#00d4aa18",
    "diffEditor.removedTextBackground": "#ff446618",

    // Git decorations
    "gitDecoration.modifiedResourceForeground": "#f5a623",
    "gitDecoration.untrackedResourceForeground": "#00d4aa",
    "gitDecoration.deletedResourceForeground": "#ff4466",
    "gitDecoration.conflictingResourceForeground": "#ff4466",
    "gitDecoration.ignoredResourceForeground": "#55556a",

    // Error / warning / info
    "editorError.foreground": "#ff4466",
    "editorWarning.foreground": "#f5a623",
    "editorInfo.foreground": "#4d9fff",

    // Selection highlight
    "editor.wordHighlightBackground": "#4d9fff18",
    "editor.wordHighlightStrongBackground": "#4d9fff28",
    "editor.findMatchBackground": "#f5a62340",
    "editor.findMatchHighlightBackground": "#f5a62320",
  },

  // Editor settings
  "editor.fontSize": 13,
  "editor.fontFamily":
    "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
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
  // Inject Argus theme settings before the configuration service starts
  await initUserConfiguration(argusUserConfig);

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
        nameShort: "Argus",
        nameLong: "Argus IDE",
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

  // [syntax-highlight-debug] After init, dump the state of every subsystem
  // that contributes to syntax highlighting. If any of these are missing
  // or empty, tokens won't render and the editor appears as plain text.
  //
  // Common causes of no syntax highlighting:
  //  1. No language registered for the file's extension → LanguageService
  //     never assigns a language ID, so TextMate never runs.
  //  2. Language registered but no grammar for its scope → TextMate loads
  //     but produces no tokens.
  //  3. Grammar loaded but theme has no `tokenColors` → tokens exist but
  //     all map to the default foreground.
  //  4. TextMate worker crashed on startup (see worker-spawn logs above).
  //  5. Theme service still on a built-in theme while our Argus color
  //     customizations only override workbench colors, not token colors.
  try {
    // Dynamic imports so a failure here never blocks the main init path.
    const [{ ILanguageService }, { IThemeService }] = await Promise.all([
      import("@codingame/monaco-vscode-api/services"),
      import("@codingame/monaco-vscode-api/services"),
    ]);

    const languageService = (await getService(ILanguageService)) as unknown as {
      getRegisteredLanguageIds?: () => string[];
    };
    const languageIds =
      languageService.getRegisteredLanguageIds?.() ?? [];
    console.log(
      `[syntax-highlight-debug] registered languages (${languageIds.length}):`,
      languageIds,
    );
    if (languageIds.length === 0) {
      console.error(
        "[syntax-highlight-debug] NO LANGUAGES REGISTERED — extensions didn't load. Check vscodeExtensions.ts imports and extension-host worker.",
      );
    }

    const themeService = (await getService(IThemeService)) as unknown as {
      getColorTheme?: () => {
        id?: string;
        label?: string;
        tokenColors?: unknown[];
        semanticHighlighting?: boolean;
      };
    };
    const theme = themeService.getColorTheme?.();
    const tokenColorCount = Array.isArray(theme?.tokenColors)
      ? theme!.tokenColors!.length
      : "unknown";
    console.log("[syntax-highlight-debug] active theme:", {
      id: theme?.id,
      label: theme?.label,
      tokenColorCount,
      semanticHighlighting: theme?.semanticHighlighting,
    });
    if (tokenColorCount === 0 || tokenColorCount === "unknown") {
      console.error(
        "[syntax-highlight-debug] Theme has no tokenColors — syntax highlighting will render as plain foreground. Check that theme-defaults-default-extension loaded and workbench.colorTheme resolves to a real theme.",
      );
    }
  } catch (err) {
    console.error(
      "[syntax-highlight-debug] failed to introspect syntax highlighting state",
      err,
    );
  }

  // After services are ready, disable "Open Folder" commands.
  // Argus controls workspace switching via its own sidebar — users
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
export {
  Parts,
  attachPart,
  isPartVisibile,
  onPartVisibilityChange,
  setPartVisibility,
};
