import type { GuestListItem } from "@argus/peacock";
import { useCallback, useId, useMemo, useState } from "react";
import {
  Banner,
  Button,
  CopyField,
  Dialog,
  GuestList,
  Icons,
  Spinner,
} from "@argus/peacock";
import { shareableDeviceKey } from "../../../lib/huddleDevice";
import {
  huddleApproveGuest,
  huddleDenyGuest,
  huddleStart,
  huddleStop,
} from "../../../lib/ipc";
import { findDevice } from "../../../stores/deviceStore";
import { useHuddleRoomForAgent } from "../../../stores/huddleStore";
import { useRuntimeTargetState } from "../../../stores/simulatorStore";
import styles from "./HuddleDialog.module.css";
import { ShareDisclosure } from "./shareDisclosure";
import { useClaimHolderLabel } from "./useClaimHolderLabel";

interface HuddleDialogProps {
  agentId: string;
  onClose: () => void;
  sessionId: string;
}

/**
 * Start a share, hand over the link, and keep the room while it is live.
 *
 * One dialog for both halves on purpose: the engineer pastes the link, then
 * comes straight back here to let people in, so the guest list has to be where
 * the link was.
 */
export function HuddleDialog({
  agentId,
  sessionId,
  onClose,
}: HuddleDialogProps) {
  const titleId = useId();
  const room = useHuddleRoomForAgent(agentId);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = useRuntimeTargetState(sessionId);
  const deviceKey = useMemo(
    () => shareableDeviceKey(target, sessionId),
    [target, sessionId],
  );
  const sharedKey = room?.device_key ?? deviceKey;
  const deviceName = sharedKey
    ? (findDevice(sharedKey)?.name ?? "the device you have open")
    : null;
  const drivingLabel = useClaimHolderLabel(sharedKey);

  const guests: GuestListItem[] = useMemo(
    () =>
      (room?.guests ?? []).map((g) => ({
        id: g.dev_static_pub,
        label: g.label,
        state: g.state,
        connected: g.connected,
        driving: g.state === "approved" && g.label === drivingLabel,
      })),
    [room, drivingLabel],
  );

  const start = useCallback(() => {
    setStarting(true);
    setError(null);
    huddleStart(agentId, deviceKey)
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Could not get a share link.",
        );
      })
      .finally(() => setStarting(false));
  }, [agentId, deviceKey]);

  const end = useCallback(() => {
    if (!room) {
      return;
    }
    huddleStop(room.id).catch(() => {});
    onClose();
  }, [room, onClose]);

  if (!room) {
    return (
      <Dialog
        onClose={onClose}
        size="medium"
        title="Share this agent"
        titleId={titleId}
      >
        <div className={styles.body}>
          <ShareDisclosure deviceName={deviceName} />
          {!deviceKey && (
            <Banner tone="info">
              No device is open, so the huddle is chat only. Open one before
              sharing if you want guests to drive it.
            </Banner>
          )}
          {error && <Banner tone="error">{error}</Banner>}
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={starting}
            leading={starting ? <Spinner size="xs" /> : undefined}
            variant="primary"
            onClick={start}
          >
            {starting ? "Getting a link…" : "Start sharing"}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog onClose={onClose} size="medium" title="Huddle" titleId={titleId}>
      <div className={styles.body}>
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Share this link</p>
          <CopyField
            copyLabel="Copy huddle link"
            placeholder="Getting a link…"
            value={room.url ?? ""}
          />
          <p className={styles.hint}>
            The link alone gets nobody in — you approve each person here.
          </p>
        </div>
        <div className={styles.section}>
          <p className={styles.sectionTitle}>
            <Icons.GuestsIcon size={12} />
            People
          </p>
          <GuestList
            guests={guests}
            onApprove={(id) => {
              huddleApproveGuest(room.id, id).catch(() => {});
            }}
            onDeny={(id) => {
              huddleDenyGuest(room.id, id).catch(() => {});
            }}
          />
        </div>
        <ShareDisclosure deviceName={deviceName} />
      </div>
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
        <Button variant="danger" onClick={end}>
          End huddle
        </Button>
      </div>
    </Dialog>
  );
}
