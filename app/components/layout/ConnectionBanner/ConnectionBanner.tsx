import { Banner, Button } from "@argus/peacock";
import { LOCAL_HOST_ID, focusHost } from "../../../lib/transport";
import {
  dismissUnreachableHost,
  useFocusedConnection,
  useUnreachableHosts,
} from "../../../stores/connectionStore";

/**
 * Says out loud when the UI is not driving what the user thinks it is: a host
 * that went away mid-session, or a saved host that could not be re-attached at
 * launch.
 */
export function ConnectionBanner() {
  const connection = useFocusedConnection();
  const unreachable = useUnreachableHosts();

  if (unreachable.length > 0) {
    const label = unreachable[0];

    return (
      <Banner
        tone="warning"
        trailing={
          <Button variant="ghost" onClick={() => dismissUnreachableHost(label)}>
            Dismiss
          </Button>
        }
      >
        Could not reach {label} — its projects are not loaded.
      </Banner>
    );
  }

  if (connection.mode !== "remote" || connection.state === "ready") {
    return null;
  }

  const reconnecting =
    connection.state === "connecting" || connection.state === "handshaking";

  return (
    <Banner
      tone={reconnecting ? "info" : "error"}
      trailing={
        <Button
          variant="ghost"
          onClick={() => {
            focusHost(LOCAL_HOST_ID).catch(() => undefined);
          }}
        >
          Use this Mac
        </Button>
      }
    >
      {reconnecting
        ? `Reconnecting to ${connection.label}…`
        : `Disconnected from ${connection.label}. Agents keep running there; this window will catch up when it reconnects.`}
    </Banner>
  );
}
