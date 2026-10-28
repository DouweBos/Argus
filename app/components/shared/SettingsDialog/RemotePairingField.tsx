import type { PairingClient, RemoteDevice } from "../../../lib/types";
import { useCallback, useState } from "react";
import {
  Button,
  Icons,
  QrCode,
  SettingsScreenField,
  Toggle,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  remoteCancelPairing,
  remoteConfirmPairing,
  remoteStartPairing,
} from "../../../lib/ipc";
import { canDriveArgus, pairingClientLabel } from "../../../lib/pairingClient";
import styles from "./RemoteAccessSection.module.css";

type PairPhase = "awaiting-sas" | "idle" | "starting" | "waiting-device";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Monospace code with a copy button that reveals on hover, like chat. */
function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  return (
    <div className={styles.codeRow}>
      <code className={styles.code}>{value}</code>
      <button
        type="button"
        className={styles.copyBtn}
        onClick={copy}
        aria-label="Copy pairing code"
      >
        {copied ? <Icons.CheckIcon size={13} /> : <Icons.CopyIcon size={13} />}
      </button>
    </div>
  );
}

interface RemotePairingFieldProps {
  /** The gateway is up and has at least one address to put in the QR. */
  canPair: boolean;
  onError: (message: string | null) => void;
  onPaired: () => void;
}

export function RemotePairingField({
  canPair,
  onError,
  onPaired,
}: RemotePairingFieldProps) {
  const [phase, setPhase] = useState<PairPhase>("idle");
  const [qr, setQr] = useState<{
    pairingCode: string;
    qrPayload: string;
  } | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [pairingClient, setPairingClient] = useState<PairingClient | null>(
    null,
  );
  const [grantControl, setGrantControl] = useState(false);
  const [grantAdmin, setGrantAdmin] = useState(false);

  const reset = useCallback(() => {
    setGrantAdmin(false);
    setPhase("idle");
    setQr(null);
    setSas(null);
    setPairingClient(null);
    setGrantControl(false);
  }, []);

  useIpcEvent<{ client: PairingClient | null; sas: string }>(
    "remote:pairing-sas",
    (p) => {
      setSas(p.sas);
      setPairingClient(p.client ?? null);
      // Only another desktop can drive this one, so a phone or a browser is
      // never offered the keyboard.
      if (p.client && p.client.kind !== "desktop") {
        setGrantAdmin(false);
      }
      setPhase("awaiting-sas");
    },
  );
  useIpcEvent<{ device: RemoteDevice }>("remote:pairing-complete", () => {
    reset();
    onPaired();
  });
  useIpcEvent<{ message: string }>("remote:pairing-error", (p) => {
    onError(p.message);
    reset();
  });

  const start = async () => {
    onError(null);
    setPhase("starting");
    try {
      const res = await remoteStartPairing();
      setQr({ qrPayload: res.qrPayload, pairingCode: res.pairingCode });
      setPhase("waiting-device");
    } catch (e) {
      onError(errorText(e));
      reset();
    }
  };

  const confirm = async () => {
    onError(null);
    try {
      await remoteConfirmPairing({ control: grantControl, admin: grantAdmin });
    } catch (e) {
      onError(errorText(e));
    }
  };

  const cancel = () => {
    remoteCancelPairing().catch(() => {});
    reset();
  };

  return (
    <SettingsScreenField
      label="Pair a device"
      caption="Scan the QR on your phone, then confirm the 6-digit code matches on both screens."
    >
      {phase === "idle" ? (
        <Button variant="primary" disabled={!canPair} onClick={start}>
          {canPair ? "Start pairing" : "Waiting for an address…"}
        </Button>
      ) : (
        <div className={styles.pairing}>
          {phase === "starting" && <p className={styles.muted}>Starting…</p>}
          {qr && phase === "waiting-device" && (
            <>
              <QrCode value={qr.qrPayload} size={200} alt="Pairing QR code" />
              <p className={styles.muted}>Or paste this code into the app:</p>
              <CopyableCode value={qr.pairingCode} />
              <p className={styles.muted}>Waiting for the device…</p>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </>
          )}
          {phase === "awaiting-sas" && sas && (
            <>
              <p className={styles.muted}>
                {pairingClient
                  ? `${pairingClientLabel(pairingClient)} wants to pair. Confirm this code matches the one on its screen:`
                  : "Confirm this code matches the one on your device:"}
              </p>
              <div className={styles.sas}>{sas}</div>
              <label className={styles.controlToggle}>
                <Toggle
                  checked={grantControl || grantAdmin}
                  disabled={grantAdmin}
                  onChange={setGrantControl}
                />
                <span>
                  Allow this device to control agents (send messages, spawn
                  agents, create sessions)
                </span>
              </label>
              {canDriveArgus(pairingClient) && (
                <label className={styles.controlToggle}>
                  <Toggle checked={grantAdmin} onChange={setGrantAdmin} />
                  <span>
                    Let this device drive Argus like a second keyboard — for
                    another Mac of yours running the desktop app, never a
                    browser or phone.
                  </span>
                </label>
              )}
              <div className={styles.pairActions}>
                <Button variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={confirm}>
                  Codes match — pair
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </SettingsScreenField>
  );
}
