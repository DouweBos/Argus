/**
 * Which chat affordances an agent's runner supports: rewinding / forking its
 * transcript and side questions are Claude Code only. Unknown runners and
 * older hosts, which don't say, count as able.
 */

import { useEffect } from "react";
import type { RemoteRunner } from "../lib/protocol";
import { useAgentsStore } from "./agents";
import { useConnectionStore } from "./connection";
import { useStartStore } from "./start";

export interface RunnerSupport {
  transcriptFork: boolean;
  sideQuestion: boolean;
}

export function runnerSupport(
  runners: RemoteRunner[],
  runnerId: string | undefined,
): RunnerSupport {
  const runner = runners.find((r) => r.id === (runnerId ?? "claude-code"));

  return {
    transcriptFork: runner?.supports_transcript_fork ?? true,
    sideQuestion: runner?.supports_side_question ?? true,
  };
}

export function useRunnerSupport(agentId: string): RunnerSupport {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const loadRunners = useStartStore((s) => s.loadRunners);
  const runners = useStartStore((s) => s.runners);
  const runnerId = useAgentsStore((s) => s.statusByAgent[agentId]?.runner_id);
  useEffect(() => {
    if (ready) {
      loadRunners().catch(() => {});
    }
  }, [ready, loadRunners]);

  return runnerSupport(runners, runnerId);
}
