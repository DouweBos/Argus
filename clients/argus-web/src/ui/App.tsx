import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Icons,
  Spinner,
  TextArea,
} from "@argus/peacock";
import { PairingClient, parsePairingInput } from "@argus/remote-client";
import { parseHuddleToken } from "../lib/huddleIdentity";
import { defaultDeviceName, identityFromPairing } from "../lib/keystore";
import { wsOrigin } from "../lib/origin";
import { useConnectionStore } from "../stores/connection";
import { capture } from "../telemetry/telemetry";
import { HuddleGuest } from "./HuddleGuest";
import { Monitor } from "./Monitor";

export function App() {
  const identity = useConnectionStore((s) => s.identity);
  const init = useConnectionStore((s) => s.init);
  // Guest vs. paired mode is decided once — a live tab never switches between
  // them — but a second share link pasted into a guest tab is a new room.
  const [huddleToken, setHuddleToken] = useState(() =>
    parseHuddleToken(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHuddleToken(window.location.hash);
      setHuddleToken((prev) => (prev && next ? next : prev));
    };
    window.addEventListener("hashchange", onHashChange);

    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!huddleToken) {
      init();
    }
  }, [huddleToken, init]);

  if (huddleToken) {
    return <HuddleGuest token={huddleToken} />;
  }

  return identity ? <Monitor /> : <Pair />;
}

// --- Pairing ---------------------------------------------------------------

/**
 * A pairing code handed over in the link (`#/pair/<code>`, e.g. from a QR).
 * Fragment only, so it never reaches a server; dropped from the address bar
 * as soon as it is read.
 */
let launchCode: string | null = null;

function takePairingCode(): string {
  launchCode ??= readPairingCode();

  return launchCode;
}

function readPairingCode(): string {
  const match = /^#\/pair\/(.+)$/.exec(window.location.hash);
  if (!match) {
    return "";
  }
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function Pair() {
  const pairComplete = useConnectionStore((s) => s.pairComplete);
  const [code, setCode] = useState(takePairingCode);
  const [sas, setSas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<PairingClient | null>(null);

  useEffect(() => () => clientRef.current?.cancel(), []);

  // A pairing link opened in a tab already showing this screen.
  useEffect(() => {
    const onHashChange = () => {
      const next = readPairingCode();
      if (next) {
        setCode(next);
      }
    };
    window.addEventListener("hashchange", onHashChange);

    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const begin = () => {
    setError(null);
    try {
      const payload = parsePairingInput(code);
      const client = new PairingClient(
        payload,
        {
        onSas: setSas,
        onPaired: (result) => {
          capture("web_paired", {
            has_control: result.capabilities.includes("control"),
          });
          pairComplete(identityFromPairing(result));
        },
        onError: (m) => {
          capture("web_pair_failed", { reason: "failed" });
          setError(m);
          setSas(null);
        },
        },
        {
          // The host serves this bundle, so our own origin is the route that
          // definitely works — the URL in the code may not be.
          url: wsOrigin(),
          client: {
            product: "Argus Web",
            kind: "web",
            device: defaultDeviceName(),
          },
        },
      );
      clientRef.current = client;
      client.start();
    } catch {
      capture("web_pair_failed", { reason: "invalid_code" });
      setError("That doesn't look like a valid pairing code.");
    }
  };

  return (
    <div className="aw-shell">
      <header className="aw-hero">
        <Icons.ArgusLogo size={24} />
        <h1 className="aw-title">Argus Remote</h1>
      </header>
      <p className="aw-muted">
        In Argus: Settings → Remote Access → Start pairing, then paste the
        pairing code here.
      </p>

      {sas ? (
        <Card size="sm" stack>
          <p className="aw-muted">
            Confirm this matches the code in Argus, then tap “Codes match —
            pair” on your computer:
          </p>
          <div className="aw-sas">{sas}</div>
          <div className="aw-inline">
            <Spinner size="sm" />
            <span className="aw-muted">Waiting for confirmation…</span>
          </div>
        </Card>
      ) : (
        <Card size="sm" stack>
          <TextArea
            mono
            className="aw-pair-code"
            placeholder="paste pairing code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div>
            <Button variant="primary" disabled={!code.trim()} onClick={begin}>
              Pair
            </Button>
          </div>
        </Card>
      )}
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  );
}
