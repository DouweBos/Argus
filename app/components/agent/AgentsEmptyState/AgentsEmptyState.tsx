import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Chip, IconBadge, Icons, TextArea } from "@argus/peacock";
import {
  sendUserMessageToAgent,
  startAgentInSession,
} from "../../../lib/agentLifecycle";
import {
  type CanonicalPermissionMode,
  permissionModeDisplayName,
} from "../../../lib/permissionModes";
import { isSessionReady } from "../../../lib/types";
import { pushError } from "../../../stores/notificationsStore";
import { useSessions } from "../../../stores/sessionStore";
import { PermissionModePicker } from "../PermissionModePicker";
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [permissionMode, setPermissionMode] =
    useState<CanonicalPermissionMode>("auto");
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const permissionChipRef = useRef<HTMLDivElement>(null);

  const trimmed = prompt.trim();
  const canSubmit = trimmed.length > 0 && canStart && ready && !submitting;

  const submitLabel = (() => {
    if (submitting) {
      return "Starting…";
    }
    if (permissionMode === "auto") {
      return "Start agent";
    }

    return `Start in ${permissionModeDisplayName(permissionMode).toLowerCase()} mode`;
  })();

  const spawn = useCallback(
    async (mode: CanonicalPermissionMode) => {
      if (!canSubmit) {
        return;
      }
      setSubmitting(true);
      const message = trimmed;
      try {
        const info = await startAgentInSession(sessionId, {
          focus: true,
          permissionMode: mode === "auto" ? undefined : mode,
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
        spawn(permissionMode);
      }
    },
    [spawn, permissionMode],
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
            spawn(permissionMode);
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
            <div className={styles.composerLeft}>
              <button
                type="button"
                className={styles.advancedLink}
                onClick={() => setAdvancedOpen(true)}
                title="Open the full Start agent dialog (model, linked projects, images)"
              >
                Advanced…
              </button>
              <div ref={permissionChipRef} className={styles.permissionAnchor}>
                <Chip
                  interactive
                  muted={permissionMode === "auto"}
                  aria-label="Switch permission mode"
                  title={`Permission mode: ${permissionModeDisplayName(permissionMode)}`}
                  onClick={() => setPermissionPickerOpen((o) => !o)}
                >
                  {permissionModeDisplayName(permissionMode)}
                </Chip>
                {permissionPickerOpen && (
                  <PermissionModePicker
                    triggerRef={permissionChipRef}
                    currentMode={permissionMode}
                    onClose={() => setPermissionPickerOpen(false)}
                    onSelect={(m) => {
                      setPermissionPickerOpen(false);
                      setPermissionMode(m);
                    }}
                  />
                )}
              </div>
            </div>
            <div className={styles.composerActions}>
              <Button
                variant="primary"
                type="submit"
                leading={<Icons.AgentStartIcon size={12} />}
                disabled={!canSubmit}
              >
                {submitLabel}
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

      {advancedOpen && (
        <StartAgentDialog
          initialMode={permissionMode}
          sessionId={sessionId}
          onClose={() => setAdvancedOpen(false)}
        />
      )}
    </div>
  );
}
