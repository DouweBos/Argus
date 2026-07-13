/**
 * Inline activity row shown at the foot of the transcript while the agent is
 * working or blocked — mirrors the desktop's "Crystallizing…" status bubble
 * (pulsing dot + whimsical verb + animated dots).
 */

import { useEffect, useState } from "react";
import { StatusDot, ThinkingDots } from "@argus/peacock";
import { deriveActivity, randomSpinnerVerb } from "../lib/activity";
import { useAppStore } from "../lib/store";

export function WorkingIndicator({ agentId }: { agentId: string }) {
  const status = useAppStore((s) => s.statusByAgent[agentId]?.status);
  const pendingTool = useAppStore((s) => s.pendingToolByAgent[agentId] ?? null);
  const messages = useAppStore((s) => s.messagesByAgent[agentId]);
  const prompts = useAppStore((s) => s.prompts);

  // A pending prompt this client can answer, or a tool call still awaiting one.
  const hasPendingPermission =
    Object.keys(prompts).some((k) => k.startsWith(`${agentId}:`)) ||
    (messages ?? []).some((m) =>
      m.tool_calls.some((tc) => tc.pending_permission || tc.status === "pending"),
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
  const [verb, setVerb] = useState(randomSpinnerVerb);
  const [wasThinking, setWasThinking] = useState(false);
  useEffect(() => {
    if (isThinking && !wasThinking) {
      setVerb(randomSpinnerVerb());
      setWasThinking(true);
    } else if (!isThinking && wasThinking) {
      setWasThinking(false);
    }
  }, [isThinking, wasThinking]);

  if (activity.state === "idle" || activity.state === "stopped") {
    return null;
  }

  return (
    <div className="aw-activity">
      <StatusDot
        tone={activity.state === "working" ? "accent" : "warning"}
        pulse={activity.state === "working"}
      />
      <span className="aw-activity-text">
        {isThinking ? verb : activity.description}
      </span>
      {activity.state === "working" && <ThinkingDots />}
    </div>
  );
}
