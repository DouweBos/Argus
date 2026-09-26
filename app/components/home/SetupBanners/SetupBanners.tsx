/**
 * Environment setup surfaced as home-screen cards rather than onboarding
 * slides — the checks the old Preflight / Claude auth / Permissions steps ran,
 * shown only when something is actually wrong.
 */

import type { DependencyStatus, PrereqResult } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Banner, Button } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { checkDependencies, runPrereqFixer } from "../../../lib/ipc";
import { showSettingsDialog } from "../../../stores/settingsStore";
import {
  dismissSetupCard,
  runAuthCheck,
  runSetupChecks,
  useSetupChecks,
} from "../../../stores/setupChecksStore";
import { useNotificationPermission } from "./useNotificationPermission";

/** Covered by the prereq checks below — skip them in the dependency list. */
const DEPS_COVERED_BY_PREREQS = new Set(["claude", "git"]);

/** A guard so callers can render the result it just checked. */
function needsAttention(
  result: PrereqResult | undefined,
): result is PrereqResult {
  return result !== undefined && result.status !== "pass";
}

/** What the auth banner says, per the reason the check found. */
const AUTH_MESSAGES: Record<
  NonNullable<PrereqResult["auth_reason"]>,
  { body: string; cta: string; headline: string }
> = {
  no_accounts: {
    headline: "No Claude account authenticated.",
    body: "Sign in so Argus can spawn agents.",
    cta: "Sign in",
  },
  unauthenticated: {
    headline: "No Claude account can authenticate.",
    body: "Sign in again to renew the credentials.",
    cta: "Sign in",
  },
  selected_rate_limited: {
    headline: "Rate-limited account selected.",
    body: "Another account has quota — switch to it to keep spawning agents.",
    cta: "Switch account",
  },
  selected_signed_out: {
    headline: "Signed-out account selected.",
    body: "Another account is ready — switch to it to spawn agents.",
    cta: "Switch account",
  },
  all_rate_limited: {
    headline: "Every Claude account is out of usage.",
    body: "Limits clear on their own, or add another account.",
    cta: "Manage accounts",
  },
  unverifiable: {
    headline: "Could not verify your Claude account.",
    body: "Re-check once you have network — the credentials may be fine.",
    cta: "Manage accounts",
  },
};

/**
 * Claude auth card. The check probes every signed-in account, so a spent quota
 * on the selected one reads as "switch account" rather than "you aren't signed
 * in" — the two need different fixes and shouldn't share a message.
 */
function ClaudeAuthBanner({ result }: { result: PrereqResult }) {
  const { running } = useSetupChecks();
  const copy = AUTH_MESSAGES[result.auth_reason ?? "no_accounts"];

  return (
    <Banner
      tone="warning"
      trailing={
        <>
          <Button
            variant="secondary"
            disabled={running}
            onClick={() => {
              runAuthCheck().catch(() => {});
            }}
          >
            {running ? "Checking…" : "Re-check"}
          </Button>
          <Button
            variant="primary"
            onClick={() => showSettingsDialog("claude-account")}
          >
            {copy.cta}
          </Button>
        </>
      }
    >
      <strong>{copy.headline}</strong> {copy.body}
    </Banner>
  );
}

export function SetupBanners() {
  const { results, running } = useSetupChecks();
  const dismissed = useSetupChecks((s) => s.dismissed);
  const [missingDeps, setMissingDeps] = useState<DependencyStatus[]>([]);
  const [fixing, setFixing] = useState<string | null>(null);
  const notifications = useNotificationPermission();

  useEffect(() => {
    runSetupChecks().catch(() => {});
  }, []);

  // Signing in, switching or exhausting an account all move the auth card, and
  // the check re-probes accounts rather than trusting the previous verdict.
  useIpcEvent("claude-auth:accounts-changed", () => {
    runAuthCheck().catch(() => {});
  });

  useEffect(() => {
    checkDependencies()
      .then((report) =>
        setMissingDeps(
          report.dependencies.filter(
            (d) => !d.installed && !DEPS_COVERED_BY_PREREQS.has(d.id),
          ),
        ),
      )
      .catch(() => setMissingDeps([]));
  }, []);

  const recheck = () => {
    runSetupChecks(true).catch(() => {});
  };

  const fix = (id: "claude_cli") => {
    setFixing(id);
    runPrereqFixer(id)
      .then(() => runSetupChecks(true))
      .catch(() => {})
      .finally(() => setFixing(null));
  };

  const claudeCli = results.claude_cli;
  const claudeAuth = results.claude_auth;
  const gitCli = results.git_cli;
  const gitIdentity = results.git_identity;
  const showNotifications =
    notifications.supported &&
    notifications.permission !== "granted" &&
    !dismissed.includes("notifications");

  return (
    <>
      {needsAttention(claudeCli) && (
        <Banner
          tone="error"
          trailing={
            claudeCli?.fixable ? (
              <Button
                variant="secondary"
                disabled={fixing === "claude_cli"}
                onClick={() => fix("claude_cli")}
              >
                {fixing === "claude_cli" ? "Installing…" : "Install"}
              </Button>
            ) : (
              <Button variant="secondary" disabled={running} onClick={recheck}>
                Re-check
              </Button>
            )
          }
        >
          <strong>Claude Code CLI not installed.</strong> Agents can&apos;t run
          without it. {claudeCli?.detail}
        </Banner>
      )}
      {!needsAttention(claudeCli) && needsAttention(claudeAuth) && (
        <ClaudeAuthBanner result={claudeAuth} />
      )}
      {needsAttention(gitCli) && (
        <Banner tone="error">
          <strong>Git not found.</strong> Sessions are git worktrees, so git is
          required. {gitCli?.detail}
        </Banner>
      )}
      {needsAttention(gitIdentity) && (
        <Banner
          tone="warning"
          trailing={
            <Button
              variant="secondary"
              onClick={() => showSettingsDialog("git")}
            >
              Set identity
            </Button>
          }
        >
          <strong>Git identity not configured.</strong> Commits agents make
          won&apos;t have an author until you set a name and email.
        </Banner>
      )}
      {showNotifications && (
        <Banner
          tone="info"
          onDismiss={() => dismissSetupCard("notifications")}
          trailing={
            notifications.permission === "denied" ? undefined : (
              <Button
                variant="secondary"
                disabled={notifications.asking}
                onClick={() => {
                  notifications.request().catch(() => {});
                }}
              >
                {notifications.asking ? "Asking…" : "Enable"}
              </Button>
            )
          }
        >
          {notifications.permission === "denied" ? (
            <>
              <strong>Notifications are blocked.</strong> Enable them for Argus
              in System Settings to get pinged when agents need you.
            </>
          ) : (
            <>
              <strong>Notifications are off.</strong> Turn them on to get pinged
              when an agent finishes a turn or asks for permission.
            </>
          )}
        </Banner>
      )}
      {missingDeps.map((dep) => (
        <Banner
          key={dep.id}
          tone={dep.severity === "required" ? "error" : "warning"}
        >
          <strong>{dep.name}</strong> not found. {dep.purpose} {dep.hint}
        </Banner>
      ))}
    </>
  );
}
