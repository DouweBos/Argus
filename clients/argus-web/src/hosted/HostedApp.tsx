/**
 * The hosted client at houwert.dev/argus/app: sign in with the Argus account,
 * get this browser approved by a device already on it, pick a computer, and
 * use the same monitor UI the LAN client has against that computer's tunnel.
 */

import { useEffect } from "react";
import { Banner, Button, Card, Spinner } from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { useAppStore } from "../lib/store";
import { Monitor } from "../ui/Monitor";
import { ComputersScreen } from "./ComputersScreen";
import { HostedFrame } from "./HostedFrame";
import { JoinScreen } from "./JoinScreen";
import { SignInScreen } from "./SignInScreen";

function Waiting({ label }: { label: string }) {
  return (
    <div className="aw-center">
      <Spinner size="sm" />
      <span>{label}</span>
    </div>
  );
}

function EmptyAccount() {
  const checkAgain = useAccountStore((s) => s.checkAgain);
  const signOut = useAccountStore((s) => s.signOut);

  return (
    <Card size="sm" stack>
      <p className="aw-muted">
        Your account has no devices yet. Sign in with the Argus app on your
        iPhone or Mac first — that device sets the account up and can then
        approve this browser.
      </p>
      <div className="aw-inline">
        <Button variant="primary" onClick={() => void checkAgain()}>
          Check again
        </Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Card>
  );
}

export function HostedApp() {
  const phase = useAccountStore((s) => s.phase);
  const error = useAccountStore((s) => s.error);
  const boot = useAccountStore((s) => s.boot);
  const openHost = useAppStore((s) => s.identity?.account);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (openHost && phase === "ready") {
    return <Monitor />;
  }

  const banner = error && <Banner tone="error">{error}</Banner>;
  switch (phase) {
    case "loading":
    case "settingUp":
      return (
        <HostedFrame title="Argus">
          <Waiting label="Checking your account…" />
        </HostedFrame>
      );
    case "unsupported":
      return (
        <HostedFrame title="Argus">
          <Banner tone="warning">
            This browser can't keep an Argus device key. Use a current Chrome,
            Edge, Firefox or Safari, outside private browsing.
          </Banner>
        </HostedFrame>
      );
    case "unavailable":
      return (
        <HostedFrame title="Argus">
          <Banner tone="error">
            Couldn't reach the Argus account service. Check your connection
            and reload.
          </Banner>
        </HostedFrame>
      );
    case "signedOut":
      return (
        <HostedFrame title="Sign in to Argus">
          {banner}
          <SignInScreen />
        </HostedFrame>
      );
    case "empty":
      return (
        <HostedFrame title="Argus">
          <EmptyAccount />
        </HostedFrame>
      );
    case "awaitingApproval":
      return (
        <HostedFrame title="Approve this browser">
          {banner}
          <JoinScreen />
        </HostedFrame>
      );
    default:
      return <ComputersScreen />;
  }
}
