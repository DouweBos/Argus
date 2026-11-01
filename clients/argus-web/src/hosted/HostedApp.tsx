/**
 * The hosted client at houwert.dev/argus/app: sign in with the Argus account,
 * get this browser approved by a device already on it, pick a computer, and
 * use the same monitor UI the LAN client has against that computer's tunnel.
 *
 * `?host=<id>` names the computer, so a link opens on it and Back leaves it.
 * An id this account can't reach shows as unavailable; it never falls back to
 * another computer.
 */

import { useEffect, useState } from "react";
import { Banner, Button, Card, Spinner } from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { appNavigate } from "../routing/router";
import { HOME } from "../routing/screens";
import { useAppLocation } from "../routing/useAppLocation";
import { useConnectionStore } from "../stores/connection";
import { Monitor } from "../ui/Monitor";
import { ComputersScreen } from "./ComputersScreen";
import { HostedFrame } from "./HostedFrame";
import { JoinScreen } from "./JoinScreen";
import { openComputer } from "./openComputer";
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

/**
 * `?host=` names a computer that isn't open yet: open it, or say why not
 * once a fresh directory read still can't reach it.
 */
function HostGate({ hostId }: { hostId: string }) {
  const computers = useAccountStore((s) => s.computers);
  const refresh = useAccountStore((s) => s.refresh);
  const [refreshed, setRefreshed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const computer = computers.find((c) => c.id === hostId);
  const reachable = !!computer && computer.routes.length > 0;

  useEffect(() => {
    void refresh().finally(() => setRefreshed(true));
  }, [refresh, hostId, attempt]);

  useEffect(() => {
    if (computer && reachable) {
      openComputer(computer);
    }
  }, [computer, reachable]);

  if (reachable || !refreshed) {
    return (
      <HostedFrame title="Argus">
        <Waiting label={computer ? `Opening ${computer.name}…` : "Finding the computer…"} />
      </HostedFrame>
    );
  }

  return (
    <HostedFrame title="Computer unavailable">
      <Card size="sm" stack>
        <p className="aw-muted">
          {computer
            ? `${computer.name} has no secure route right now. Turn on remote access on that computer, then try again.`
            : "That computer isn't on your account, or this browser can't reach it."}
        </p>
        <div className="aw-inline">
          <Button
            variant="primary"
            onClick={() => {
              setRefreshed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
          <Button
            variant="ghost"
            onClick={() => appNavigate(HOME, { hostId: null })}
          >
            All computers
          </Button>
        </div>
      </Card>
    </HostedFrame>
  );
}

export function HostedApp() {
  const phase = useAccountStore((s) => s.phase);
  const error = useAccountStore((s) => s.error);
  const boot = useAccountStore((s) => s.boot);
  const openHost = useConnectionStore((s) => s.identity?.account);
  const { hostId } = useAppLocation();

  useEffect(() => {
    void boot();
  }, [boot]);

  // The URL is what's open: dropping `?host=` (Back, or "Computers") closes it.
  useEffect(() => {
    if (openHost && openHost.hostId !== hostId) {
      useConnectionStore.getState().closeHost();
    }
  }, [openHost, hostId]);

  if (phase === "ready" && hostId) {
    return openHost?.hostId === hostId ? <Monitor /> : <HostGate hostId={hostId} />;
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
