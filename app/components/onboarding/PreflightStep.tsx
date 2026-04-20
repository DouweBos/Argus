import type { PrereqId, PrereqResult, PrereqStatus } from "../../lib/types";
import { useEffect, useState } from "react";
import { Button, ChecklistRow, CodeBlock } from "@argus/peacock";
import { useIpcEvent } from "../../hooks/useIpcEvent";
import { useOnboarding } from "../../hooks/useOnboarding";
import { checkPrereqs, runPrereqFixer } from "../../lib/ipc";
import {
  setPrereq,
  setPrereqs,
  useOnboardingStore,
} from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";

interface PrereqMeta {
  fixHint?: string;
  hint?: string;
  mobileOnly?: boolean;
  title: string;
}

const META: Record<PrereqId, PrereqMeta> = {
  claude_cli: {
    title: "Claude Code CLI",
    fixHint: "npm install -g @anthropic-ai/claude-code",
  },
  claude_auth: {
    title: "Claude authentication",
    fixHint: "claude login",
  },
  git_cli: { title: "Git on PATH" },
  git_identity: { title: "Git identity" },
  native_bridge: { title: "Native sim bridge", mobileOnly: true },
  xcode: { title: "Xcode", mobileOnly: true },
  ios_runtimes: { title: "iOS simulator runtimes", mobileOnly: true },
  android_sdk: { title: "Android SDK", mobileOnly: true },
  android_avd: { title: "Android AVDs", mobileOnly: true },
  playwright: { title: "Playwright browsers" },
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
    // Kick off once when the step mounts.
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
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(Object.keys(META) as PrereqId[]).map((id) => {
          const result = prereqs[id];
          const meta = META[id];
          const status: PrereqStatus = result?.status ?? "running";

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
              {result?.status === "fail" && meta.fixHint ? (
                <CodeBlock code={meta.fixHint} />
              ) : null}
            </ChecklistRow>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
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
