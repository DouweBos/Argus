import { useEffect, useRef, useState } from "react";
import { Button, ChecklistRow, CodeBlock } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { claudePing } from "../../lib/ipc";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";

type PingState = "checking" | "failed" | "idle" | "ok";

function pingMessage(state: PingState, error: string | null): string {
  if (state === "ok") {
    return "Authenticated";
  }
  if (state === "failed") {
    return error ?? "ping failed";
  }

  return "Not yet verified";
}

function pingTone(state: PingState): "fail" | "pass" | "running" | "warn" {
  if (state === "ok") {
    return "pass";
  }
  if (state === "failed") {
    return "fail";
  }
  if (state === "checking") {
    return "running";
  }

  return "warn";
}

export function ClaudeAuthStep() {
  const { advance, skipStep } = useOnboarding();
  const preflightPassed = useOnboardingStore(
    (s) => s.prereqs.claude_auth?.status === "pass",
  );
  const [state, setState] = useState<PingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const autoAdvanced = useRef(false);

  useEffect(() => {
    if (preflightPassed && !autoAdvanced.current) {
      autoAdvanced.current = true;
      advance("launcher").catch(() => {});
    }
  }, [preflightPassed, advance]);

  const ping = async () => {
    setState("checking");
    setError(null);
    try {
      const r = await claudePing();
      if (r.ok) {
        setState("ok");
      } else {
        setState("failed");
        setError(r.error ?? "ping failed");
      }
    } catch (e) {
      setState("failed");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <OnboardingLayout
      currentStep="claude_auth"
      title="Connect Claude"
      subtitle="Argus spawns Claude Code agents for every session. Run `claude login` in a terminal to authenticate, then click Re-check."
      footerLeft={
        <Button
          variant="ghost"
          onClick={() => {
            skipStep("claude_auth", "launcher").catch(() => {});
          }}
        >
          I&apos;ll do this later
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          disabled={state !== "ok"}
          onClick={() => {
            advance("launcher").catch(() => {});
          }}
        >
          Continue
        </Button>
      }
    >
      <CodeBlock code="claude login" language="bash" />
      <ChecklistRow
        title="Claude CLI ping"
        message={pingMessage(state, error)}
        tone={pingTone(state)}
        action={
          <Button
            variant="secondary"
            size="sm"
            disabled={state === "checking"}
            onClick={() => {
              ping().catch(() => {});
            }}
          >
            {state === "checking" ? "Checking…" : "Re-check"}
          </Button>
        }
      />
    </OnboardingLayout>
  );
}
