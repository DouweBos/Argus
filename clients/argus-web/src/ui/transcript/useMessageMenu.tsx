/**
 * Copy, edit and fork from a message, the way the phone's long-press menu
 * does: an edit rewinds the chat and sends in its place, a fork starts a new
 * agent (in a new session, or this one) with the chat up to that message.
 */

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { copyText, describeError } from "@argus/client-core";
import { ForkChatDialog } from "@argus/peacock";
import type { RemoteMessage } from "../../lib/protocol";
import { openAgent } from "../../routing/open";
import { useAgentsStore } from "../../stores/agents";
import { useConnectionStore } from "../../stores/connection";
import { capture } from "../../telemetry/telemetry";
import type { MessageEdit, MessageMenu } from "./TranscriptMessage";

type Role = "assistant" | "user";

const roleOf = (msg: RemoteMessage): Role =>
  msg.role === "user" ? "user" : "assistant";

export function useMessageMenu(
  agentId: string,
  enabled: boolean,
): {
  menu: MessageMenu | undefined;
  editFor: (msg: RemoteMessage) => MessageEdit | undefined;
  dialog: ReactNode;
} {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const status = useAgentsStore((s) => s.statusByAgent[agentId]?.status);
  const rewind = useAgentsStore((s) => s.rewind);
  const fork = useAgentsStore((s) => s.fork);
  const [editing, setEditing] = useState<{
    id: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [forking, setForking] = useState<RemoteMessage | null>(null);
  const live = status !== undefined && status !== "stopped";

  const menu = useMemo<MessageMenu | undefined>(
    () =>
      enabled
        ? {
            canChange: hasControl && live,
            onCopy: (msg) => {
              const text = copyText(msg);
              if (text) {
                void navigator.clipboard?.writeText(text).catch(() => {});
                capture("web_message_action", {
                  action: "copy",
                  role: roleOf(msg),
                  success: true,
                });
              }
            },
            onEdit: (msg) => setEditing({ id: msg.id, busy: false, error: null }),
            onFork: (msg) => setForking(msg),
          }
        : undefined,
    [enabled, hasControl, live],
  );

  const editFor = useCallback(
    (msg: RemoteMessage): MessageEdit | undefined => {
      if (editing?.id !== msg.id) {
        return undefined;
      }

      return {
        busy: editing.busy,
        error: editing.error,
        onCancel: () => setEditing(null),
        onSave: (text) => {
          setEditing({ id: msg.id, busy: true, error: null });
          rewind(agentId, msg, text)
            .then(() => {
              capture("web_message_action", {
                action: "edit",
                role: "user",
                success: true,
              });
              setEditing(null);
            })
            .catch((err: unknown) => {
              capture("web_message_action", {
                action: "edit",
                role: "user",
                success: false,
              });
              setEditing({ id: msg.id, busy: false, error: describeError(err) });
            });
        },
      };
    },
    [agentId, editing, rewind],
  );

  const dialog = forking && (
    <ForkChatDialog
      onClose={() => setForking(null)}
      onSubmit={async (request) => {
        const action = request.into === "session" ? "fork_session" : "fork_agent";
        try {
          const forked = await fork(agentId, forking, request);
          capture("web_message_action", {
            action,
            role: roleOf(forking),
            success: true,
          });
          openAgent({
            agent_id: forked.agent.agent_id,
            session_id: forked.sessionId,
          });
        } catch (err) {
          capture("web_message_action", {
            action,
            role: roleOf(forking),
            success: false,
          });
          throw new Error(describeError(err));
        }
      }}
    />
  );

  return { menu, editFor, dialog };
}
