import { Banner, Button } from "@argus/peacock";
import { switchConnection } from "../../../lib/transport";
import { useConnection } from "../../../stores/connectionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";

/**
 * Says out loud when the UI is not driving what the user thinks it is: a host
 * that went away mid-session, or a saved host that was unreachable at launch so
 * we booted local instead.
 */
export function ConnectionBanner() {
  const connection = useConnection();

  if (connection.fallbackFrom) {
    return (
      <Banner
        tone="warning"
        trailing={
          <Button variant="ghost" onClick={() => showSettingsDialog("hosts")}>
            Hosts
          </Button>
        }
      >
        Could not reach {connection.fallbackFrom} — running on this Mac instead.
      </Banner>
    );
  }

  if (connection.mode !== "remote" || connection.state === "ready") {
    return null;
  }

  const label = connection.hostLabel ?? "the host";
  const reconnecting =
    connection.state === "connecting" || connection.state === "handshaking";

  return (
    <Banner
      tone={reconnecting ? "info" : "error"}
      trailing={
        <Button variant="ghost" onClick={() => switchConnection(null)}>
          Use this Mac
        </Button>
      }
    >
      {reconnecting
        ? `Reconnecting to ${label}…`
        : `Disconnected from ${label}. Agents keep running there; this window will catch up when it reconnects.`}
    </Banner>
  );
}
