import type {
  ConversationMessage,
  ToolCallInfo,
} from "../../../stores/conversationStore";
import { memo, useState } from "react";
import {
  runningBackgroundCalls,
  stillRunningLabel,
} from "@argus/host/services/agent/conversation/background";
import { CollapsedToolGroup as ToolGroup } from "@argus/peacock";
import { ToolCallCard } from "../ToolCallCard";
import { categorizeTools } from "../categorizeTools";

interface CollapsedToolGroupProps {
  agentId?: string;
  messages: ConversationMessage[];
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
  ) => Promise<void> | void;
  onSaveToolCallToDisk?: (toolCall: ToolCallInfo) => void;
}

export const CollapsedToolGroup = memo(function CollapsedToolGroup({
  agentId,
  messages,
  onPermissionRespond,
  onSaveToolCallToDisk,
}: CollapsedToolGroupProps) {
  const hasPendingPermission = messages.some((m) =>
    m.toolCalls.some((tc) => tc.pendingPermission),
  );
  const [userExpanded, setUserExpanded] = useState(false);

  // Auto-expand when a permission request is pending; user toggle applies otherwise.
  const expanded = hasPendingPermission || userExpanded;

  return (
    <ToolGroup
      categories={categorizeTools(messages)}
      endTimestamp={messages[messages.length - 1]?.timestamp}
      expanded={expanded}
      messageCount={messages.length}
      stillRunning={stillRunningLabel(runningBackgroundCalls(messages))}
      timestamp={messages[0]?.timestamp}
      toolCallCount={messages.reduce((sum, m) => sum + m.toolCalls.length, 0)}
      onToggle={() => setUserExpanded((v) => !v)}
    >
      {messages.map((msg) =>
        msg.toolCalls.map((tc) => (
          <ToolCallCard
            key={tc.id}
            agentId={agentId}
            toolCall={tc}
            onPermissionRespond={onPermissionRespond}
            onSaveToDisk={onSaveToolCallToDisk}
          />
        )),
      )}
    </ToolGroup>
  );
}, sameGroup);

/** A regrouped run is a fresh array; equal when it holds the same messages. */
function sameGroup(
  prev: CollapsedToolGroupProps,
  next: CollapsedToolGroupProps,
): boolean {
  return (
    prev.agentId === next.agentId &&
    prev.onPermissionRespond === next.onPermissionRespond &&
    prev.onSaveToolCallToDisk === next.onSaveToolCallToDisk &&
    prev.messages.length === next.messages.length &&
    prev.messages.every((m, i) => m === next.messages[i])
  );
}
