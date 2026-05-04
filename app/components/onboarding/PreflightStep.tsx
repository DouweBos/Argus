import type { PrereqId, PrereqResult } from "../../lib/types";
import { useMemo, useState } from "react";
import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { PLUGINS } from "../../plugins/registry";
import { getEffectivePluginEnabled } from "../../plugins/store";
import { PrereqList } from "../shared/PrereqList";
import { OnboardingLayout } from "./OnboardingLayout";

const REQUIRED: PrereqId[] = ["claude_cli", "git_cli", "git_identity"];

/**
 * Core prereqs that always run regardless of which plugins are enabled. The
 * `claude_auth` step has its own dedicated onboarding step so it's also
 * checked here as part of the broader preflight set.
 */
const CORE_PREREQS: PrereqId[] = [
  "claude_cli",
  "claude_auth",
  "git_cli",
  "git_identity",
];

function allRequiredOk(prereqs: Record<string, PrereqResult>): boolean {
  return REQUIRED.every((id) => prereqs[id]?.status === "pass");
}

export function PreflightStep() {
  const { advance } = useOnboarding();
  const [results, setResults] = useState<Record<string, PrereqResult>>({});

  // Filter prereqs to core + the union of every enabled plugin's declared
  // prereqs. A user who picked zero plugins sees only the four core checks;
  // full picker = today's full list.
  const ids = useMemo<PrereqId[]>(() => {
    const enabled = PLUGINS.filter((p) => getEffectivePluginEnabled(p.id));
    const pluginPrereqs = enabled.flatMap((p) => p.prereqs ?? []);

    return Array.from(new Set([...CORE_PREREQS, ...pluginPrereqs]));
  }, []);

  const required = allRequiredOk(results);

  return (
    <OnboardingLayout
      currentStep="preflight"
      title="Preflight check"
      subtitle="Verifying tooling on your Mac. Required items must pass; plugin-only items are optional but their plugins won't work without them."
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
      <PrereqList ids={ids} onResults={setResults} />
    </OnboardingLayout>
  );
}
