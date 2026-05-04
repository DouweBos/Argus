import { useCallback, useMemo, useRef, useState } from "react";
import { Button, IconBadge, Icons, TextArea } from "@argus/peacock";
import {
  sendUserMessageToAgent,
  startAgentInSession,
} from "../../../lib/agentLifecycle";
import { isSessionReady } from "../../../lib/types";
import { pushError } from "../../../stores/notificationsStore";
import { useSessions } from "../../../stores/sessionStore";
import { StartAgentDialog } from "../StartAgentDialog";
import styles from "./AgentsEmptyState.module.css";

interface AgentsEmptyStateProps {
  sessionId: string;
}

export function AgentsEmptyState({ sessionId }: AgentsEmptyStateProps) {
  const sessions = useSessions();
  const session = useMemo(
    () => sessions.find((w) => w.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const canStart = useMemo(() => {
    if (!session) {
      return false;
    }
    if (typeof session.status === "object") {
      return false;
    }

    return session.status !== "deleting";
  }, [session]);

  const ready = session ? isSessionReady(session.status) : false;

  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [advancedMode, setAdvancedMode] = useState<"default" | "plan" | null>(
    null,
  );
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = prompt.trim();
  const canSubmit = trimmed.length > 0 && canStart && ready && !submitting;

  const spawn = useCallback(
    async (mode: "default" | "plan") => {
      if (!canSubmit) {
        return;
      }
      setSubmitting(true);
      const message = trimmed;
      try {
        const info = await startAgentInSession(sessionId, {
          focus: true,
          permissionMode: mode === "plan" ? "plan" : undefined,
        });
        await sendUserMessageToAgent(info.agent_id, message, undefined, {
          assumeIdle: true,
        });
        setPrompt("");
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "start_agent",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, sessionId, trimmed],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        spawn("default");
      }
    },
    [spawn],
  );

  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <IconBadge size="lg" tone="neutral">
            <Icons.AgentIcon size={20} />
          </IconBadge>
          <h1 className={styles.title}>Start an agent</h1>
          <p className={styles.body}>
            Describe what you want done. The agent will spawn here and start
            working — open more tabs to run agents in parallel.
          </p>
        </div>

        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            spawn("default");
          }}
        >
          <TextArea
            ref={promptRef}
            autoFocus
            placeholder="What should the agent work on?"
            rows={4}
            value={prompt}
            disabled={!canStart}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.composerFooter}>
            <button
              type="button"
              className={styles.advancedLink}
              onClick={() => setAdvancedMode("default")}
              title="Open the full Start agent dialog (model, linked projects, images)"
            >
              Advanced…
            </button>
            <div className={styles.composerActions}>
              <Button
                variant="ghost"
                leading={<Icons.AgentStartIcon size={12} />}
                disabled={!canSubmit}
                onClick={() => spawn("plan")}
                title="Start in plan mode — agent must present a plan before any writes"
              >
                Plan mode
              </Button>
              <Button
                variant="primary"
                type="submit"
                leading={<Icons.AgentStartIcon size={12} />}
                disabled={!canSubmit}
              >
                {submitting ? "Starting…" : "Start agent"}
              </Button>
            </div>
          </div>
          <div className={styles.hint}>
            <kbd className={styles.kbd}>⌘</kbd>
            <kbd className={styles.kbd}>↵</kbd>
            <span>to start</span>
          </div>
        </form>
      </div>

      {advancedMode && (
        <StartAgentDialog
          mode={advancedMode}
          sessionId={sessionId}
          onClose={() => setAdvancedMode(null)}
        />
      )}
    </div>
  );
}
