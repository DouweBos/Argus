import type { PrereqId, PrereqResult, PrereqStatus } from "../../lib/types";
import { useEffect, useState } from "react";
import { Button, ChecklistRow, CodeBlock } from "@argus/peacock";
import { useIpcEvent } from "../../hooks/useIpcEvent";
import { useOnboarding } from "../../hooks/useOnboarding";
import { checkPrereqs, openExternalUrl, runPrereqFixer } from "../../lib/ipc";
import {
  setPrereq,
  setPrereqs,
  useOnboardingStore,
} from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./PreflightStep.module.css";

interface PrereqMeta {
  installCommand?: string;
  installLabel?: string;
  installUrl?: string;
  mobileOnly?: boolean;
  title: string;
}

const META: Record<PrereqId, PrereqMeta> = {
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
    installCommand:
      'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
  },
  native_bridge: {
    title: "Native sim bridge",
    mobileOnly: true,
    installCommand: "pnpm --filter argus build:native",
  },
  xcode: {
    title: "Xcode",
    mobileOnly: true,
    installLabel: "App Store",
    installUrl: "https://apps.apple.com/app/xcode/id497799835",
  },
  ios_runtimes: {
    title: "iOS simulator runtimes",
    mobileOnly: true,
    installCommand: "xcodebuild -downloadPlatform iOS",
    installLabel: "Apple docs",
    installUrl:
      "https://developer.apple.com/documentation/xcode/installing-additional-simulator-runtimes",
  },
  android_sdk: {
    title: "Android SDK",
    mobileOnly: true,
    installCommand: "brew install --cask android-platform-tools",
    installLabel: "Android Studio",
    installUrl: "https://developer.android.com/studio",
  },
  android_avd: {
    title: "Android AVDs",
    mobileOnly: true,
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

const REQUIRED: PrereqId[] = ["claude_cli", "git_cli", "git_identity"];

function allRequiredOk(prereqs: Record<string, PrereqResult>): boolean {
  return REQUIRED.every((id) => prereqs[id]?.status === "pass");
}

export function PreflightStep() {
  const { advance } = useOnboarding();
  const prereqs = useOnboardingStore((s) => s.prereqs);
  const [busy, setBusy] = useState(false);

  useIpcEvent<PrereqResult>("onboarding:prereq_update", (r) => {
    setPrereq(r);
  });

  useEffect(() => {
    runChecks().catch(() => {});
  }, []);

  const runChecks = async () => {
    setBusy(true);
    try {
      const results = await checkPrereqs();
      setPrereqs(results);
    } finally {
      setBusy(false);
    }
  };

  const required = allRequiredOk(prereqs);

  const onFix = async (id: PrereqId) => {
    await runPrereqFixer(id);
    await runChecks();
  };

  const skipMobile = () => {
    const mobileIds: PrereqId[] = [
      "native_bridge",
      "xcode",
      "ios_runtimes",
      "android_sdk",
      "android_avd",
    ];
    mobileIds.forEach((id) => {
      setPrereq({ id, status: "skipped", mobileOnly: true });
    });
  };

  return (
    <OnboardingLayout
      currentStep="preflight"
      title="Preflight check"
      subtitle="Verifying tooling on your Mac. Required items must pass; mobile-only items are optional."
      footerLeft={
        <Button variant="ghost" onClick={skipMobile}>
          Skip mobile for now
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          disabled={!required}
          onClick={() => {
            advance("claude_auth").catch(() => {});
          }}
        >
          Continue
        </Button>
      }
    >
      <div className={styles.grid}>
        {(Object.keys(META) as PrereqId[]).map((id) => {
          const result = prereqs[id];
          const meta = META[id];
          const status: PrereqStatus = result?.status ?? "running";
          const showInstall =
            status === "fail" ||
            status === "warn" ||
            (status === "skipped" && meta.mobileOnly);

          return (
            <ChecklistRow
              key={id}
              title={meta.title + (meta.mobileOnly ? " (mobile)" : "")}
              message={result?.message}
              tone={status}
              detail={result?.detail}
              action={
                result?.fixable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onFix(id).catch(() => {});
                    }}
                  >
                    Fix
                  </Button>
                ) : undefined
              }
            >
              {showInstall && meta.installCommand ? (
                <CodeBlock code={meta.installCommand} />
              ) : null}
              {showInstall && meta.installUrl ? (
                <div className={styles.installLine}>
                  <span>How to install:</span>
                  <button
                    type="button"
                    className={styles.installLink}
                    onClick={() => {
                      openExternalUrl(meta.installUrl!).catch(() => {});
                    }}
                  >
                    {meta.installLabel ?? meta.installUrl}
                  </button>
                </div>
              ) : null}
            </ChecklistRow>
          );
        })}
      </div>
      <div className={styles.rerun}>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            runChecks().catch(() => {});
          }}
        >
          Re-run checks
        </Button>
      </div>
    </OnboardingLayout>
  );
}
