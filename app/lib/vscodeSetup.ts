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
import {
  getResolvedTheme,
  subscribeResolvedTheme,
  type ResolvedTheme,
} from "../stores/themeStore";
import { createLogger } from "./logger";
import { registerIpcFilesystem } from "./vscodeFilesystem";
import { loadLocalExtensions } from "./vscodeLocalExtensions";

const log = createLogger("syntax-highlight-debug");

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
        log.info(`spawned worker "${label}" (${name}) url=${url.href}`);
        w.addEventListener("error", (e) => {
          log.error(
            `worker "${label}" (${name}) runtime error`,
            e.message,
            e.filename,
            e.lineno,
            e,
          );
        });
        w.addEventListener("messageerror", (e) => {
          log.error(`worker "${label}" (${name}) messageerror`, e);
        });

        return w;
      } catch (err) {
        log.error(
          `FAILED to spawn worker "${label}" (${name}) url=${url.href}`,
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
        log.warn(
          `unknown worker label "${label}" — falling back to editor worker`,
        );

        return mkWorker(editorWorkerUrl, "editor-fallback");
    }
  },
};

// ---------------------------------------------------------------------------
// Argus theme — applied as user configuration before services initialize.
//
// Maps Argus's CSS palette (tokens.css) onto VS Code's workbench color
// tokens so the editor, explorer, status bar, etc. match the surrounding
// Argus shell. Two palettes are defined — dark and light — and scoped via
// `[Default Dark Modern]` / `[Default Light Modern]` inside
// `workbench.colorCustomizations`. At runtime we flip `workbench.colorTheme`
// in response to app theme changes; VS Code applies the matching scope.
// ---------------------------------------------------------------------------

interface ArgusPalette {
  accent: string;
  accentHover: string;
  bgHover: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  border: string;
  error: string;
  success: string;
  textMuted: string;
  textOnAccent: string;
  textPrimary: string;
  textSecondary: string;
  warning: string;
}

// Dark palette — mirrors tokens.css html[data-theme="dark"]
const DARK: ArgusPalette = {
  bgPrimary: "#15151c",
  bgSecondary: "#1c1c25",
  bgTertiary: "#252531",
  bgHover: "#2d2d3c",
  border: "#27272f", // solid approximation of rgba(255,255,255,0.08) on bgPrimary
  textPrimary: "#d8d8e2",
  textSecondary: "#a8a8b8",
  textMuted: "#70708a",
  textOnAccent: "#15151c",
  accent: "#f5a623",
  accentHover: "#ffbe4d",
  error: "#ff4466",
  warning: "#f5a623",
  success: "#00d4aa",
};

// Light palette — mirrors tokens.css html[data-theme="light"]
const LIGHT: ArgusPalette = {
  bgPrimary: "#fafbfc",
  bgSecondary: "#ffffff",
  bgTertiary: "#eceef2",
  bgHover: "#dcdfe6",
  border: "#d0d3da", // solid approximation of rgba(10,10,15,0.14) on bgPrimary
  textPrimary: "#0d0d14",
  textSecondary: "#2f2f40",
  textMuted: "#5c5c72",
  textOnAccent: "#ffffff",
  accent: "#c7861f",
  accentHover: "#e09820",
  error: "#dc2c49",
  warning: "#d69a00",
  success: "#00a884",
};

function buildColorCustomizations(p: ArgusPalette): Record<string, string> {
  return {
    // Editor
    "editor.background": p.bgPrimary,
    "editor.foreground": p.textPrimary,
    "editor.lineHighlightBackground": p.bgTertiary,
    "editor.selectionBackground": `${p.accent}40`,
    "editor.inactiveSelectionBackground": `${p.accent}20`,
    "editorCursor.foreground": p.accent,
    "editorLineNumber.foreground": p.textMuted,
    "editorLineNumber.activeForeground": p.textSecondary,
    "editorIndentGuide.background": p.border,
    "editorIndentGuide.activeBackground": p.bgHover,
    "editorWidget.background": p.bgSecondary,
    "editorWidget.border": p.border,
    "editorBracketMatch.border": `${p.accent}80`,
    "editorBracketMatch.background": `${p.accent}18`,
    "editorGutter.background": p.bgPrimary,
    "editorOverviewRuler.border": p.border,
    "editorGroup.border": p.border,
    "editorGroupHeader.tabsBackground": p.bgSecondary,
    "editorGroupHeader.tabsBorder": p.border,

    // Tabs
    "tab.activeBackground": p.bgPrimary,
    "tab.activeForeground": p.textPrimary,
    "tab.activeBorderTop": p.accent,
    "tab.inactiveBackground": p.bgSecondary,
    "tab.inactiveForeground": p.textMuted,
    "tab.border": p.border,
    "tab.hoverBackground": p.bgHover,

    // Activity bar (hidden, but keep colors for consistency)
    "activityBar.background": p.bgPrimary,
    "activityBar.foreground": p.textPrimary,
    "activityBar.inactiveForeground": p.textMuted,
    "activityBar.border": p.border,
    "activityBarBadge.background": p.accent,
    "activityBarBadge.foreground": p.textOnAccent,

    // Sidebar (explorer, search, etc.)
    "sideBar.background": p.bgSecondary,
    "sideBar.foreground": p.textSecondary,
    "sideBar.border": p.border,
    "sideBarTitle.foreground": p.textPrimary,
    "sideBarSectionHeader.background": p.bgSecondary,
    "sideBarSectionHeader.foreground": p.textSecondary,
    "sideBarSectionHeader.border": p.border,

    // Lists (file tree, search results, etc.)
    "list.activeSelectionBackground": `${p.accent}20`,
    "list.activeSelectionForeground": p.textPrimary,
    "list.inactiveSelectionBackground": p.bgHover,
    "list.inactiveSelectionForeground": p.textPrimary,
    "list.hoverBackground": p.bgHover,
    "list.hoverForeground": p.textPrimary,
    "list.focusOutline": `${p.accent}80`,
    "list.highlightForeground": p.accent,

    // Status bar
    "statusBar.background": p.bgPrimary,
    "statusBar.foreground": p.textMuted,
    "statusBar.border": p.border,
    "statusBar.noFolderBackground": p.bgPrimary,
    "statusBarItem.hoverBackground": p.bgHover,
    "statusBarItem.activeBackground": p.bgHover,

    // Title bar
    "titleBar.activeBackground": p.bgPrimary,
    "titleBar.activeForeground": p.textPrimary,
    "titleBar.inactiveBackground": p.bgPrimary,
    "titleBar.inactiveForeground": p.textMuted,
    "titleBar.border": p.border,

    // Panel (problems, output, terminal)
    "panel.background": p.bgPrimary,
    "panel.border": p.border,
    "panelTitle.activeBorder": p.accent,
    "panelTitle.activeForeground": p.textPrimary,
    "panelTitle.inactiveForeground": p.textMuted,

    // Input controls
    "input.background": p.bgTertiary,
    "input.foreground": p.textPrimary,
    "input.border": p.border,
    "input.placeholderForeground": p.textMuted,
    "inputOption.activeBorder": p.accent,
    "inputOption.activeBackground": `${p.accent}30`,
    focusBorder: p.accent,

    // Buttons
    "button.background": p.accent,
    "button.foreground": p.textOnAccent,
    "button.hoverBackground": p.accentHover,

    // Dropdown
    "dropdown.background": p.bgSecondary,
    "dropdown.foreground": p.textPrimary,
    "dropdown.border": p.border,

    // Badges
    "badge.background": p.accent,
    "badge.foreground": p.textOnAccent,

    // Scrollbar
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": `${p.bgHover}80`,
    "scrollbarSlider.hoverBackground": `${p.textMuted}80`,
    "scrollbarSlider.activeBackground": `${p.textMuted}80`,

    // Minimap
    "minimap.background": p.bgPrimary,

    // Breadcrumbs
    "breadcrumb.foreground": p.textMuted,
    "breadcrumb.focusForeground": p.textPrimary,
    "breadcrumb.activeSelectionForeground": p.textPrimary,
    "breadcrumbPicker.background": p.bgSecondary,

    // Notifications
    "notifications.background": p.bgSecondary,
    "notifications.foreground": p.textPrimary,
    "notifications.border": p.border,
    "notificationCenterHeader.background": p.bgSecondary,

    // Quick input (command palette)
    "quickInput.background": p.bgSecondary,
    "quickInput.foreground": p.textPrimary,
    "quickInputList.focusBackground": p.bgHover,
    "quickInputTitle.background": p.bgSecondary,

    // Peek view
    "peekView.border": p.accent,
    "peekViewEditor.background": p.bgPrimary,
    "peekViewResult.background": p.bgSecondary,
    "peekViewTitle.background": p.bgSecondary,

    // Diff editor
    "diffEditor.insertedTextBackground": `${p.success}18`,
    "diffEditor.removedTextBackground": `${p.error}18`,

    // Git decorations
    "gitDecoration.modifiedResourceForeground": p.warning,
    "gitDecoration.untrackedResourceForeground": p.success,
    "gitDecoration.deletedResourceForeground": p.error,
    "gitDecoration.conflictingResourceForeground": p.error,
    "gitDecoration.ignoredResourceForeground": p.textMuted,

    // Error / warning / info
    "editorError.foreground": p.error,
    "editorWarning.foreground": p.warning,
    "editorInfo.foreground": p.accent,

    // Selection highlight
    "editor.wordHighlightBackground": `${p.accent}18`,
    "editor.wordHighlightStrongBackground": `${p.accent}28`,
    "editor.findMatchBackground": `${p.warning}40`,
    "editor.findMatchHighlightBackground": `${p.warning}20`,
  };
}

const DARK_THEME_ID = "Default Dark Modern";
const LIGHT_THEME_ID = "Default Light Modern";

function themeIdFor(theme: ResolvedTheme): string {
  return theme === "light" ? LIGHT_THEME_ID : DARK_THEME_ID;
}

const initialResolvedTheme = getResolvedTheme();

const argusUserConfig = JSON.stringify({
  // Pick base theme from the app's resolved theme at startup. Runtime
  // changes flow through subscribeResolvedTheme below.
  "workbench.colorTheme": themeIdFor(initialResolvedTheme),
  "workbench.preferredDarkColorTheme": DARK_THEME_ID,
  "workbench.preferredLightColorTheme": LIGHT_THEME_ID,

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

  // Scope overrides by base theme so both palettes coexist. VS Code applies
  // whichever block matches the currently-active workbench.colorTheme.
  "workbench.colorCustomizations": {
    [`[${DARK_THEME_ID}]`]: buildColorCustomizations(DARK),
    [`[${LIGHT_THEME_ID}]`]: buildColorCustomizations(LIGHT),
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
        nameLong: "Argus",
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
    const languageIds = languageService.getRegisteredLanguageIds?.() ?? [];
    log.info(`registered languages (${languageIds.length}):`, languageIds);
    if (languageIds.length === 0) {
      log.error(
        "NO LANGUAGES REGISTERED — extensions didn't load. Check vscodeExtensions.ts imports and extension-host worker.",
      );
    }

    const themeService = (await getService(IThemeService)) as unknown as {
      getColorTheme?: () => {
        id?: string;
        label?: string;
        semanticHighlighting?: boolean;
        tokenColors?: unknown[];
      };
    };
    const theme = themeService.getColorTheme?.();
    const tokenColorCount = Array.isArray(theme?.tokenColors)
      ? theme!.tokenColors!.length
      : "unknown";
    log.info("active theme:", {
      id: theme?.id,
      label: theme?.label,
      tokenColorCount,
      semanticHighlighting: theme?.semanticHighlighting,
    });
    if (tokenColorCount === 0 || tokenColorCount === "unknown") {
      log.error(
        "Theme has no tokenColors — syntax highlighting will render as plain foreground. Check that theme-defaults-default-extension loaded and workbench.colorTheme resolves to a real theme.",
      );
    }
  } catch (err) {
    log.error("failed to introspect syntax highlighting state", err);
  }

  // Keep the VS Code workbench theme in sync with the app's resolved
  // theme. Writes `workbench.colorTheme` to the configuration service;
  // the scoped `workbench.colorCustomizations` above then take effect.
  try {
    const [{ IConfigurationService }, { ConfigurationTarget }] =
      await Promise.all([
        import("@codingame/monaco-vscode-api/services"),
        import("@codingame/monaco-vscode-api/services"),
      ]);

    const configurationService = (await getService(
      IConfigurationService,
    )) as unknown as {
      updateValue: (
        key: string,
        value: unknown,
        target?: unknown,
      ) => Promise<void>;
    };

    const applyTheme = (theme: ResolvedTheme) => {
      configurationService
        .updateValue(
          "workbench.colorTheme",
          themeIdFor(theme),
          ConfigurationTarget.USER,
        )
        .catch((err) =>
          log.error("failed to update workbench.colorTheme", err),
        );
    };

    subscribeResolvedTheme(applyTheme);
  } catch (err) {
    log.error("failed to wire theme sync", err);
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
