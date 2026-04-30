import type {
  McpOAuthStatus,
  McpTestResult,
  McpTool,
} from "../../../lib/types";
import { useEffect, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import {
  cancelMcpSignIn,
  getMcpOAuthStatus,
  signInToMcpServer,
  signOutFromMcpServer,
  testMcpServer,
} from "../../../lib/ipc";
import styles from "./McpTestButton.module.css";

/** Coarse status used by the parent's at-a-glance bulb indicator. */
export type McpProbeStatus =
  | "fail"
  | "needs-auth"
  | "ok"
  | "testing"
  | "unknown";

interface McpTestButtonProps {
  /** Run the probe automatically on mount / when config changes. */
  autoTest?: boolean;
  /**
   * The parsed server config (matches one entry under `mcpServers`).
   * Pass `null` when the editable JSON is invalid — the button will be
   * disabled instead of disappearing.
   */
  config: Record<string, unknown> | null;
  /** Notified whenever the probe state changes. */
  onStatusChange?: (status: McpProbeStatus) => void;
  /** Notified whenever the server's advertised tool list changes. */
  onToolsChange?: (tools: McpTool[] | undefined) => void;
}

function deriveStatus(
  test: TestState,
  auth: AuthState,
  authStatus: McpOAuthStatus | null,
): McpProbeStatus {
  if (test.kind === "running" || auth.kind === "in-progress") {
    return "testing";
  }
  if (test.kind === "done") {
    if (test.result.ok) {
      return "ok";
    }
    if (test.result.status === 401 || test.result.resourceMetadataUrl) {
      return "needs-auth";
    }

    return "fail";
  }

  return authStatus ? "ok" : "unknown";
}

type TestState =
  | { kind: "done"; result: McpTestResult }
  | { kind: "idle" }
  | { kind: "running" };

type AuthState =
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "in-progress" };

function failHeadline(r: McpTestResult): string {
  if (r.status !== undefined) {
    return r.error ?? `HTTP ${r.status}`;
  }

  return r.error ?? "Failed";
}

/**
 * Strip Electron's IPC wrapping (`Error invoking remote method 'foo': Error:`)
 * and any nested `Error:` prefixes so the message we show is the actual
 * cause from the backend.
 */
function cleanIpcError(message: string): string {
  let m = message.replace(/^Error invoking remote method '[^']+':\s*/, "");
  while (m.startsWith("Error: ")) {
    m = m.slice("Error: ".length);
  }

  return m;
}

function configUrl(config: Record<string, unknown> | null): string | null {
  if (!config) {
    return null;
  }
  const url = (config as { url?: unknown }).url;

  return typeof url === "string" ? url : null;
}

export function McpTestButton({
  config,
  autoTest = false,
  onStatusChange,
  onToolsChange,
}: McpTestButtonProps) {
  const [state, setState] = useState<TestState>({ kind: "idle" });
  const [auth, setAuth] = useState<AuthState>({ kind: "idle" });
  const [authStatus, setAuthStatus] = useState<McpOAuthStatus | null>(null);

  const url = configUrl(config);

  // Bubble status up so a parent can render an at-a-glance bulb.
  useEffect(() => {
    onStatusChange?.(deriveStatus(state, auth, authStatus));
  }, [state, auth, authStatus, onStatusChange]);

  // Bubble tool lists up so the row can show "available tools".
  useEffect(() => {
    if (state.kind === "done" && state.result.ok) {
      onToolsChange?.(state.result.tools);
    } else if (state.kind === "idle") {
      onToolsChange?.(undefined);
    }
  }, [state, onToolsChange]);

  // Check stored auth status whenever the URL changes — drives the
  // "Signed in" badge + Sign out affordance even before the user runs Test.
  useEffect(() => {
    if (!url) {
      return undefined;
    }
    let cancelled = false;
    getMcpOAuthStatus(url).then(
      (s) => {
        if (!cancelled) {
          setAuthStatus(s);
        }
      },
      () => {
        if (!cancelled) {
          setAuthStatus(null);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  const run = async () => {
    if (!config) {
      return;
    }
    setState({ kind: "running" });
    try {
      const result = await testMcpServer(config);
      setState({ kind: "done", result });
    } catch (err) {
      setState({
        kind: "done",
        result: {
          ok: false,
          transport: "unknown",
          error: (err as Error).message,
        },
      });
    }
  };

  // Kick off an automatic probe when requested by the parent (e.g. the
  // inherited-MCP list wants every row's bulb populated on mount).
  useEffect(() => {
    if (!autoTest || !config) {
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTest, url]);

  const signIn = async (resourceMetadataUrl: string | null) => {
    if (!url) {
      return;
    }
    setAuth({ kind: "in-progress" });
    try {
      const status = await signInToMcpServer({
        serverUrl: url,
        resourceMetadataUrl,
      });
      setAuthStatus(status);
      setAuth({ kind: "idle" });
      // Re-test now that we have a token.
      await run();
    } catch (err) {
      const message = cleanIpcError((err as Error).message);
      if (message.includes("cancelled")) {
        setAuth({ kind: "idle" });
      } else {
        setAuth({ kind: "error", message });
      }
    }
  };

  const signOut = async () => {
    if (!url) {
      return;
    }
    try {
      await signOutFromMcpServer(url);
      setAuthStatus(null);
    } catch {
      // Best-effort.
    }
  };

  if (state.kind === "running") {
    return (
      <Button
        disabled
        size="sm"
        variant="ghost"
        leading={<Icons.RefreshIcon className={styles.spin} size={12} />}
      >
        Testing…
      </Button>
    );
  }

  if (state.kind === "done") {
    const r = state.result;

    if (r.ok) {
      // The row's status bulb already signals success — no need for a
      // chunky "OK · 99 ms" badge here. Just expose Sign out when the
      // server is one we authenticated against.
      if (url && authStatus) {
        return (
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        );
      }

      return null;
    }

    const canSignIn =
      Boolean(url) && (r.status === 401 || Boolean(r.resourceMetadataUrl));
    const tooltip = [failHeadline(r), r.hint, r.bodySnippet]
      .filter(Boolean)
      .join("\n\n");

    return (
      <div className={styles.actions} title={tooltip}>
        {canSignIn && auth.kind === "in-progress" ? (
          <>
            <Button size="sm" variant="ghost" disabled>
              Waiting for browser…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (url) {
                  cancelMcpSignIn(url).catch(() => {
                    // Best-effort.
                  });
                }
              }}
            >
              Cancel
            </Button>
          </>
        ) : null}
        {canSignIn && auth.kind !== "in-progress" ? (
          <>
            {auth.kind === "error" ? (
              <span className={styles.failLabel} title={auth.message}>
                <Icons.WarningIcon size={12} />
                <span className={styles.failLabelText}>
                  Sign-in failed: {auth.message}
                </span>
              </span>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                signIn(r.resourceMetadataUrl ?? null);
              }}
            >
              {auth.kind === "error" ? "Try again" : "Sign in"}
            </Button>
          </>
        ) : null}
        {!canSignIn ? (
          <span className={styles.failLabel} title={tooltip}>
            <Icons.WarningIcon size={12} /> {failHeadline(r)}
          </span>
        ) : null}
        {auth.kind !== "in-progress" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              run();
            }}
          >
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      <Button
        disabled={!config}
        size="sm"
        variant="ghost"
        onClick={() => {
          run();
        }}
      >
        Test
      </Button>
      {url && authStatus ? (
        <span
          className={styles.signedIn}
          title={`Signed in: ${authStatus.resource}`}
        >
          <Icons.CheckIcon size={12} /> Signed in
        </span>
      ) : null}
      {url && authStatus ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            signOut();
          }}
        >
          Sign out
        </Button>
      ) : null}
    </div>
  );
}
