/**
 * A run of tool-call-only messages folded into one row: how many calls, which
 * kinds, and a tap to expand. Phone twin of the desktop's CollapsedToolGroup.
 */

import { useState } from "react";
import { Pressable, View } from "react-native";
import * as Icons from "./Icons";
import { TranscriptMessage, isToolCallPending } from "./TranscriptMessage";
import { Muted, Row } from "./ui";
import type { RemoteMessage } from "../lib/protocol";
import {
  categorizeTools,
  countToolCalls,
  type ToolCategory,
} from "../lib/toolGroups";
import { useAppStore } from "../stores/appStore";
import { useTheme } from "../theme";

const CATEGORY_ICONS: Record<
  ToolCategory,
  (p: { size?: number; color?: string }) => React.ReactElement | null
> = {
  read: Icons.File,
  search: Icons.Search,
  bash: Icons.Terminal,
  edit: Icons.Pencil,
  web: Icons.Web,
  agent: Icons.Agent,
  // Anything uncategorised is covered by the total count, not its own icon.
  other: () => null,
};

const CATEGORY_ORDER: ToolCategory[] = [
  "read",
  "search",
  "bash",
  "edit",
  "web",
  "agent",
];

export function CollapsedToolGroup({
  agentId,
  messages,
}: {
  agentId: string;
  messages: RemoteMessage[];
}) {
  const theme = useTheme();
  const prompts = useAppStore((s) => s.prompts);
  const answered = useAppStore((s) => s.answered);
  const [userExpanded, setUserExpanded] = useState(false);

  // A prompt buried inside the group must not be hidden behind a tap.
  const hasPending = messages.some((m) =>
    m.tool_calls.some((tc) => isToolCallPending(agentId, tc, prompts, answered)),
  );
  const expanded = hasPending || userExpanded;

  const total = countToolCalls(messages);
  const categories = categorizeTools(messages);

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${total} tool calls`}
        accessibilityState={{ expanded }}
        onPress={() => setUserExpanded((v) => !v)}
        hitSlop={6}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: theme.bgSecondary,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        {expanded ? (
          <Icons.ChevronDown size={11} color={theme.textMuted} />
        ) : (
          <Icons.ChevronRight size={11} color={theme.textMuted} />
        )}
        <Muted style={{ flex: 1 }}>
          {total} tool {total === 1 ? "call" : "calls"} · {messages.length}{" "}
          {messages.length === 1 ? "message" : "messages"}
        </Muted>
        <Row gap={7}>
          {CATEGORY_ORDER.filter((c) => categories[c] > 0).map((c) => {
            const Icon = CATEGORY_ICONS[c];

            return (
              <Row key={c} gap={2}>
                <Icon size={12} color={theme.textMuted} />
                <Muted>{categories[c]}</Muted>
              </Row>
            );
          })}
        </Row>
      </Pressable>

      {expanded &&
        messages.map((m) => (
          <TranscriptMessage key={m.id} agentId={agentId} msg={m} />
        ))}
    </View>
  );
}
