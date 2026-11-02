/**
 * A chat's rows with each turn's work folded into a "Worked for…" line, as
 * the phone and the Mac draw it. A decision waiting inside a turn keeps its
 * work open.
 */

import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  awaitsDecision,
  transcriptItems,
  type WorkLog,
  workLogCallCount,
  workLogIsWorking,
  workLogLabel,
} from "@argus/client-core";
import { WorkLogRow } from "@argus/peacock";
import type { RemoteMessage } from "../../lib/protocol";
import { usePromptsStore } from "../../stores/prompts";
import { capture } from "../../telemetry/telemetry";

/** The time, once a second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, [active]);

  return now;
}

function WorkLogItem({
  agentId,
  log,
  agentRunning,
  children,
}: {
  agentId: string;
  log: WorkLog;
  agentRunning: boolean;
  children: ReactNode;
}) {
  const prompts = usePromptsStore((s) => s.prompts);
  const answered = usePromptsStore((s) => s.answered);
  const [expanded, setExpanded] = useState(false);
  const working = workLogIsWorking(log, agentRunning);
  const now = useNow(working);
  const waiting = log.messages.some((m) =>
    m.tool_calls.some((tc) => {
      const key = `${agentId}:${tc.id}`;

      return !answered[key] && (awaitsDecision(tc) || prompts[key] != null);
    }),
  );

  return (
    <WorkLogRow
      detail={workLogCallCount(log)}
      label={workLogLabel(log, working, now)}
      locked={waiting}
      open={expanded || waiting}
      working={working}
      onToggle={() => {
        if (!expanded) {
          capture("web_transcript_work_log_opened", { working });
        }
        setExpanded((e) => !e);
      }}
    >
      {children}
    </WorkLogRow>
  );
}

export function TranscriptRows({
  agentId,
  messages,
  agentRunning,
  renderMessage,
}: {
  agentId: string;
  messages: RemoteMessage[];
  /** The agent is mid-turn: the newest work counts up. */
  agentRunning: boolean;
  renderMessage: (msg: RemoteMessage) => ReactNode;
}) {
  const items = useMemo(() => transcriptItems(messages), [messages]);

  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case "message":
            return <Fragment key={item.id}>{renderMessage(item.message)}</Fragment>;
          case "run":
            return (
              <Fragment key={item.id}>{item.messages.map((m) => <Fragment key={m.id}>{renderMessage(m)}</Fragment>)}</Fragment>
            );
          case "work":
            return (
              <WorkLogItem
                key={item.id}
                agentId={agentId}
                agentRunning={agentRunning}
                log={item.log}
              >
                {item.log.messages.map((m) => (
                  <Fragment key={m.id}>{renderMessage(m)}</Fragment>
                ))}
              </WorkLogItem>
            );
        }
      })}
    </>
  );
}
