/**
 * Display metadata for each `PrereqId` — titles + suggested install paths.
 * Lives in its own file so `PrereqList.tsx` can stay components-only and
 * Vite's fast-refresh keeps working when this table changes.
 */

import type { PrereqId } from "../../../lib/types";

interface PrereqMeta {
  installCommand?: string;
  installLabel?: string;
  installUrl?: string;
  title: string;
}

export const PREREQ_META: Record<PrereqId, PrereqMeta> = {
  claude_cli: {
    title: "Claude Code CLI",
    installCommand: "npm install -g @anthropic-ai/claude-code",
    installLabel: "Install guide",
    installUrl: "https://docs.claude.com/en/docs/claude-code/quickstart",
  },
  claude_auth: {
    title: "Claude authentication",
    installCommand: "claude login",
    installLabel: "Sign-in help",
    installUrl: "https://docs.claude.com/en/docs/claude-code/quickstart",
  },
  git_cli: {
    title: "Git on PATH",
    installCommand: "xcode-select --install",
    installLabel: "git-scm.com",
    installUrl: "https://git-scm.com/downloads/mac",
  },
  git_identity: {
    title: "Git identity",
  },
  native_bridge: {
    title: "Native sim bridge",
    installCommand: "pnpm --filter argus build:native",
  },
  xcode: {
    title: "Xcode",
    installLabel: "App Store",
    installUrl: "https://apps.apple.com/app/xcode/id497799835",
  },
  ios_runtimes: {
    title: "iOS simulator runtimes",
    installCommand: "xcodebuild -downloadPlatform iOS",
    installLabel: "Apple docs",
    installUrl:
      "https://developer.apple.com/documentation/xcode/installing-additional-simulator-runtimes",
  },
  android_sdk: {
    title: "Android SDK",
    installCommand: "brew install --cask android-platform-tools",
    installLabel: "Android Studio",
    installUrl: "https://developer.android.com/studio",
  },
  android_avd: {
    title: "Android AVDs",
    installLabel: "AVD Manager guide",
    installUrl: "https://developer.android.com/studio/run/managing-avds",
  },
  playwright: {
    title: "Playwright browsers",
    installCommand: "npx playwright install",
    installLabel: "Playwright docs",
    installUrl: "https://playwright.dev/docs/browsers",
  },
};
