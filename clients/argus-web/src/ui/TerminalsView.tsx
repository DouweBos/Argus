/**
 * A session's terminals, read-only: the host's tabs (run commands first) and
 * the one in front streaming into an xterm. Which one is in front is the
 * URL's (`/sessions/:id/terminals/:terminalId`).
 */

import {
  EmptyState,
  Icons,
  SegmentedControl,
  Spinner,
  StatusDot,
  type StatusTone,
  TerminalView,
} from "@argus/peacock";
import type { RemoteTerminal } from "@argus/remote-protocol";
import { useEffect, useMemo, useRef } from "react";
import { appNavigate } from "../routing/router";
import { useConnectionStore } from "../stores/connection";
import {
  orderedTerminals,
  terminalStream,
  terminalTitle,
  useTerminalsStore,
} from "../stores/terminals";
import type { TerminalKind } from "../telemetry/events";
import { capture } from "../telemetry/telemetry";

const EMPTY: RemoteTerminal[] = [];
const POLL_MS = 5000;

/** What the host calls a session's setup PTY. */
const SETUP_TITLE = "Setup";

function kindOf(terminal: RemoteTerminal): TerminalKind {
  if (terminal.run_title !== null) {
    return "run";
  }

  return terminal.title === SETUP_TITLE ? "setup" : "shell";
}

function exitTone(code: number | undefined): StatusTone {
  if (code === undefined) {
    return "success";
  }

  return code === 0 ? "idle" : "error";
}

function TerminalPane({ terminal }: { terminal: RemoteTerminal }) {
  const exitCode = useTerminalsStore((s) => s.exitByTerminal[terminal.id]);
  const live = useTerminalsStore((s) => s.liveByTerminal[terminal.id]);
  const stream = useMemo(() => terminalStream(terminal.id), [terminal.id]);
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (live === undefined || reported.current === terminal.id) {
      return;
    }
    reported.current = terminal.id;
    capture("web_terminal_viewed", { kind: kindOf(terminal), live });
  }, [live, terminal]);

  return (
    <div className="aw-terminal">
      <div className="aw-terminal-status">
        <StatusDot
          tone={exitTone(exitCode)}
          label={
            exitCode === undefined ? "Running" : `Exited with code ${exitCode}`
          }
        />
        <span className="aw-muted">
          {live === false ? "Refreshing every few seconds" : "Read-only"}
        </span>
      </div>
      <TerminalView
        readOnly
        aria-label={`${terminalTitle(terminal)} output`}
        className="aw-terminal-view"
        stream={stream}
      />
    </div>
  );
}

export function TerminalsView({
  sessionId,
  terminalId,
}: {
  sessionId: string;
  terminalId: string | null;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const terminals =
    useTerminalsStore((s) => s.terminalsBySession[sessionId]) ?? EMPTY;
  const load = useTerminalsStore((s) => s.loadBySession[sessionId]);
  const refreshTerminals = useTerminalsStore((s) => s.refreshTerminals);
  const ordered = useMemo(() => orderedTerminals(terminals), [terminals]);
  const active = ordered.find((t) => t.id === terminalId) ?? ordered[0];

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    void refreshTerminals(sessionId);
    const poll = setInterval(() => void refreshTerminals(sessionId), POLL_MS);

    return () => clearInterval(poll);
  }, [connection, sessionId, refreshTerminals]);

  if (!load?.loaded) {
    return load?.error ? (
      <EmptyState
        icon={<Icons.TerminalIcon size={22} />}
        title="Can't list terminals"
        body={load.error}
      />
    ) : (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Finding terminals…</span>
      </div>
    );
  }
  if (!active) {
    return (
      <EmptyState
        icon={<Icons.TerminalIcon size={22} />}
        title="No terminals running"
        body="Start a run command or open a terminal in Argus on your computer; it shows up here."
      />
    );
  }

  return (
    <div className="aw-terminals">
      {ordered.length > 1 && (
        <div className="aw-terminal-tabs">
          <SegmentedControl<string>
            aria-label="Terminals"
            options={ordered.map((t) => ({ value: t.id, label: terminalTitle(t) }))}
            value={active.id}
            onChange={(id) =>
              appNavigate(
                { name: "terminals", sessionId, terminalId: id },
                { replace: true },
              )
            }
          />
        </div>
      )}
      <TerminalPane key={active.id} terminal={active} />
    </div>
  );
}
