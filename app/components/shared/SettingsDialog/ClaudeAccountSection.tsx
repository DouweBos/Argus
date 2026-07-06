import type { ClaudeAuthStatus } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  SegmentedControl,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  claudeAuthLoginCancel,
  claudeAuthLoginStart,
  claudeAuthLoginSubmitCode,
  claudeAuthLogout,
  getClaudeAuthStatus,
  openExternalUrl,
} from "../../../lib/ipc";
import styles from "./ClaudeAccountSection.module.css";

type LoginPhase =
  | "awaiting-browser"
  | "awaiting-code"
  | "idle"
  | "starting"
  | "submitting";
type AccountType = "claudeai" | "console";

const ACCOUNT_TYPE_OPTIONS = [
  { value: "claudeai" as const, label: "Claude subscription" },
  { value: "console" as const, label: "Anthropic Console" },
];

const SUBSCRIPTION_LABELS: Record<string, string> = {
  team: "Team",
  pro: "Pro",
  max: "Max",
  enterprise: "Enterprise",
  free: "Free",
};

function planLabel(status: ClaudeAuthStatus): string | null {
  if (!status.subscriptionType) {
    return null;
  }

  return (
    SUBSCRIPTION_LABELS[status.subscriptionType] ?? status.subscriptionType
  );
}

interface SignedInAsProps {
  busy: boolean;
  onLogout: () => void;
  status: ClaudeAuthStatus | null;
}

function SignedInAs({ status, busy, onLogout }: SignedInAsProps) {
  if (status === null) {
    return <p className={styles.muted}>Checking…</p>;
  }
  if (!status.loggedIn) {
    return <p className={styles.muted}>Not signed in.</p>;
  }
  const plan = planLabel(status);

  return (
    <div className={styles.account}>
      <dl className={styles.details}>
        {status.email && (
          <div className={styles.row}>
            <dt>Email</dt>
            <dd>{status.email}</dd>
          </div>
        )}
        {status.orgName && (
          <div className={styles.row}>
            <dt>Organization</dt>
            <dd>{status.orgName}</dd>
          </div>
        )}
        {plan && (
          <div className={styles.row}>
            <dt>Plan</dt>
            <dd>{plan}</dd>
          </div>
        )}
        {status.authMethod && (
          <div className={styles.row}>
            <dt>Method</dt>
            <dd>{status.authMethod}</dd>
          </div>
        )}
      </dl>
      <Button disabled={busy} variant="secondary" onClick={onLogout}>
        {busy ? "Logging out…" : "Log out"}
      </Button>
    </div>
  );
}

export function ClaudeAccountSection() {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [accountType, setAccountType] = useState<AccountType>("claudeai");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await getClaudeAuthStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resetLogin = () => {
    setPhase("idle");
    setLoginUrl(null);
    setCode("");
  };

  // Login completes over an OAuth loopback callback once the browser redirects;
  // the backend fires this when the CLI child exits. No code paste needed.
  useIpcEvent<{ error?: string; ok: boolean }>(
    "claude-auth:login-result",
    (payload) => {
      if (payload.ok) {
        resetLogin();
        refresh();
      } else {
        setError(payload.error ?? "Login failed.");
        resetLogin();
      }
    },
  );

  // Headless fallback: the CLI couldn't open a browser and is asking for a
  // pasted code, so reveal the input.
  useIpcEvent("claude-auth:login-needs-code", () => {
    setPhase((p) => (p === "awaiting-browser" ? "awaiting-code" : p));
  });

  const startLogin = async () => {
    setError(null);
    setPhase("starting");
    try {
      // The CLI opens the browser itself; we keep the URL for the manual
      // "Reopen sign-in page" fallback rather than opening a duplicate tab.
      const { url } = await claudeAuthLoginStart(accountType === "console");
      setLoginUrl(url);
      setPhase("awaiting-browser");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      resetLogin();
    }
  };

  const submitCode = async () => {
    if (!code.trim()) {
      return;
    }
    setError(null);
    setPhase("submitting");
    try {
      const r = await claudeAuthLoginSubmitCode(code);
      if (r.ok) {
        resetLogin();
        await refresh();
      } else {
        setError(r.error ?? "Login failed.");
        setPhase("awaiting-code");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("awaiting-code");
    }
  };

  const cancelLogin = () => {
    claudeAuthLoginCancel().catch(() => {});
    setError(null);
    resetLogin();
  };

  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      await claudeAuthLogout();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loggedIn = status?.loggedIn ?? false;

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Sign in, sign out, or switch the Claude account Argus uses to run agents — no terminal required."
        title="Claude account"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField label="Signed in as">
          <SignedInAs busy={busy} status={status} onLogout={logout} />
        </SettingsScreenField>

        {phase === "idle" ? (
          <SettingsScreenField
            label={loggedIn ? "Switch account" : "Sign in"}
            caption="Opens your browser to authenticate — approve access there and Argus signs in automatically."
          >
            <div className={styles.loginStart}>
              <SegmentedControl<AccountType>
                aria-label="Account type"
                value={accountType}
                onChange={setAccountType}
                options={ACCOUNT_TYPE_OPTIONS}
              />
              <Button variant="primary" onClick={startLogin}>
                {loggedIn ? "Log in with a different account" : "Log in"}
              </Button>
            </div>
          </SettingsScreenField>
        ) : (
          <SettingsScreenField
            label="Complete sign-in"
            caption={
              phase === "awaiting-code"
                ? "Approve access in the browser, then paste the code shown there."
                : "A browser window should have opened. Approve access and this will finish on its own."
            }
          >
            <div className={styles.loginFlow}>
              {phase === "starting" ? (
                <p className={styles.muted}>Opening browser…</p>
              ) : (
                <>
                  {loginUrl && (
                    <button
                      type="button"
                      className={styles.urlLink}
                      onClick={() => openExternalUrl(loginUrl).catch(() => {})}
                    >
                      Reopen sign-in page
                    </button>
                  )}
                  {phase === "awaiting-browser" ? (
                    <>
                      <p className={styles.muted}>
                        Waiting for you to approve in your browser…
                      </p>
                      <div className={styles.loginActions}>
                        <Button variant="ghost" onClick={cancelLogin}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Input
                        autoFocus
                        placeholder="Paste authorization code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            submitCode().catch(() => {});
                          }
                        }}
                      />
                      <div className={styles.loginActions}>
                        <Button variant="ghost" onClick={cancelLogin}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          disabled={!code.trim() || phase === "submitting"}
                          onClick={submitCode}
                        >
                          {phase === "submitting" ? "Signing in…" : "Sign in"}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </SettingsScreenField>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
