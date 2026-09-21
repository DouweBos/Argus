/**
 * Inline activity row at the foot of the transcript while the agent works or is
 * blocked — pulsing dot + verb + animated dots, mirroring the desktop.
 */

import { useState } from "react";
import { Row, StatusDot, ThinkingDots, Muted } from "./ui";
import { deriveActivity, randomSpinnerVerb } from "../lib/activity";
import { useAppStore } from "../stores/appStore";

export function WorkingIndicator({ agentId }: { agentId: string }) {
  const status = useAppStore((s) => s.statusByAgent[agentId]?.status);
  const pendingTool = useAppStore((s) => s.pendingToolByAgent[agentId] ?? null);
  const messages = useAppStore((s) => s.messagesByAgent[agentId]);
  const prompts = useAppStore((s) => s.prompts);

  const hasPendingPermission =
    Object.keys(prompts).some((k) => k.startsWith(`${agentId}:`)) ||
    (messages ?? []).some((m) =>
      m.tool_calls.some(
        (tc) => tc.pending_permission || tc.status === "pending",
      ),
    );

  // Input of the currently-running tool, for a richer verb ("Editing main.ts").
  const pendingToolInput =
    (messages ?? [])
      .flatMap((m) => m.tool_calls)
      .find((tc) => tc.status === "running" && tc.name === pendingTool)?.input ??
    null;

  const activity = deriveActivity(
    status,
    pendingTool,
    pendingToolInput,
    hasPendingPermission,
  );
  const isThinking = activity.description === "Thinking";

  // Hold one verb stable per thinking episode so it doesn't flicker per render.
  const [episode, setEpisode] = useState(0);
  const [wasThinking, setWasThinking] = useState(false);

  if (isThinking !== wasThinking) {
    setWasThinking(isThinking);
    if (isThinking) {
      setEpisode((e) => e + 1);
    }
  }

  if (activity.state === "idle" || activity.state === "stopped") {
    return null;
  }

  return (
    <Row gap={8} style={{ paddingVertical: 6 }}>
      <StatusDot
        tone={activity.state === "working" ? "accent" : "warning"}
        pulse={activity.state === "working"}
      />
      <Muted>
        {isThinking ? (
          <SpinnerVerb key={episode} />
        ) : (
          activity.description
        )}
      </Muted>
      {activity.state === "working" && <ThinkingDots />}
    </Row>
  );
}

/** Remounted per thinking episode; the verb is picked once, on mount. */
function SpinnerVerb() {
  const [verb] = useState(randomSpinnerVerb);

  return <>{verb}</>;
}
