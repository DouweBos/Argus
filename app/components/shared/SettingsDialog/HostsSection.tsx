import type { RemoteHost } from "../../../stores/settingsStore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  HostConnectionList,
  Input,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
} from "@argus/peacock";
import {
  PairingClient,
  parsePairingInput,
  type PairingResult,
} from "@argus/remote-client";
import { useHostEntries } from "../../../hooks/useHostEntries";
import { forgetHost } from "../../../lib/transport";
import {
  addRemoteHost,
  renameRemoteHost,
  useRemoteHosts,
} from "../../../stores/settingsStore";
import styles from "./HostsSection.module.css";

type Phase = "awaiting-sas" | "idle" | "pairing";

/** "wss://mini.tailnet.ts.net" → "mini.tailnet.ts.net". */
function labelFromUrl(url: string): string {
  return url.replace(/^wss?:\/\//, "").split("/")[0] || "Host";
}

function HostRow({
  host,
  onForget,
}: {
  host: RemoteHost;
  onForget: (id: string) => void;
}) {
  const [label, setLabel] = useState(host.label);

  return (
    <div className={styles.host}>
      <div className={styles.hostInfo}>
        <Input
          aria-label="Host name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => renameRemoteHost(host.id, label.trim() || host.label)}
        />
        <span className={styles.meta}>
          {labelFromUrl(host.url)}
          {host.capabilities.includes("admin")
            ? " · full control"
            : " · limited grant — this host will refuse most commands"}
        </span>
      </div>
      <div className={styles.hostActions}>
        <Button variant="ghost" onClick={() => onForget(host.id)}>
          Forget
        </Button>
      </div>
    </div>
  );
}

/**
 * The client half of remote access: hosts *this* Mac can attach to. Pairing
 * runs against a code generated on the other machine's Remote access screen.
 */
export function HostsSection() {
  const hosts = useRemoteHosts();
  const { entries, busyId, attach, detach, focus } = useHostEntries();
  const forget = useCallback((id: string) => {
    forgetHost(id).catch(() => undefined);
  }, []);

  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [sas, setSas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<PairingClient | null>(null);

  useEffect(() => () => clientRef.current?.cancel(), []);

  const onPaired = useCallback((result: PairingResult) => {
    addRemoteHost({
      id: result.deviceId,
      label: labelFromUrl(result.url),
      url: result.url,
      devPrivB64: result.devPrivB64,
      devPubB64: result.devPubB64,
      hostPubB64: result.hostPubB64,
      capabilities: result.capabilities,
      pairedAt: Date.now(),
    });
    setPhase("idle");
    setSas(null);
    setCode("");
  }, []);

  const startPairing = () => {
    setError(null);
    try {
      const payload = parsePairingInput(code);
      const client = new PairingClient(payload, {
        onSas: (next) => {
          setSas(next);
          setPhase("awaiting-sas");
        },
        onPaired,
        onError: (message) => {
          setError(message);
          setSas(null);
          setPhase("idle");
        },
      });
      clientRef.current = client;
      setPhase("pairing");
      client.start();
    } catch {
      setError("That doesn't look like a valid pairing code.");
    }
  };

  const cancelPairing = () => {
    clientRef.current?.cancel();
    clientRef.current = null;
    setPhase("idle");
    setSas(null);
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Run agents on another Mac and drive them from here. Pair against a code from that machine's Remote access screen, grant this Mac admin there, then pick it in the connection menu. A headless Mac mini and a workstation look identical from this side."
        title="Hosts"
      />
      <SettingsScreenDetailBody>
        <SettingsScreenField
          label="Pair a host"
          caption="Paste the pairing code shown on the other Mac's Remote access screen."
        >
          <div className={styles.pairRow}>
            <Input
              aria-label="Pairing code"
              placeholder="Pairing code"
              value={code}
              disabled={phase !== "idle"}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              variant="primary"
              disabled={!code.trim() || phase !== "idle"}
              onClick={startPairing}
            >
              Pair
            </Button>
          </div>
          {phase === "pairing" && !sas && (
            <p className={styles.meta}>Connecting to the host…</p>
          )}
          {sas && (
            <div className={styles.sasBlock}>
              <p className={styles.meta}>
                Confirm this code matches the one on the host, then approve it
                there with the Admin grant ticked:
              </p>
              <div className={styles.sas}>{sas}</div>
              <Button variant="ghost" onClick={cancelPairing}>
                Cancel
              </Button>
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </SettingsScreenField>

        <SettingsScreenField
          label="Attached hosts"
          caption="Several can be attached at once — a Mac mini for iOS, another box for Android. Each keeps its own projects and its own connection."
        >
          <HostConnectionList
            busyId={busyId}
            hosts={entries}
            onAttach={attach}
            onDetach={detach}
            onFocus={focus}
          />
        </SettingsScreenField>

        <SettingsScreenField
          label="Paired hosts"
          caption="Rename or forget a machine this Mac has pairing keys for."
        >
          {hosts.length === 0 ? (
            <p className={styles.meta}>No hosts paired yet.</p>
          ) : (
            <div className={styles.hostList}>
              {hosts.map((host) => (
                <HostRow key={host.id} host={host} onForget={forget} />
              ))}
            </div>
          )}
        </SettingsScreenField>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
