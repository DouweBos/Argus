/**
 * Where a command runs when the app is attached to a remote host.
 *
 * Most commands go to the host — that is the point. The exceptions are
 * commands that act on the machine the *window* is on, or on this client's own
 * trust store. `@argus/remote-protocol`'s `HOST_ONLY_COMMANDS` is the host-side
 * denylist; this adds the client's view of the same boundary.
 */

import { HOST_ONLY_COMMANDS } from "@argus/remote-protocol";

export type CommandTarget = "client" | "host" | "unavailable";

/**
 * Host-only commands with no meaning on the far end but a perfectly good one
 * here: opening an OAuth link must use *this* browser, and the popout windows,
 * quit flow and updater are this app's own.
 */
const CLIENT_EXECUTED = new Set([
  "open_external_url",
  "show_open_dialog",
  "show_image_context_menu",
  "open_agent_popout",
  "close_agent_popout",
  "open_device_popout",
  "close_device_popout",
  "close_window",
  "app_confirm_quit",
  "app_cancel_quit",
]);

/**
 * Host-only commands that reach into a filesystem the client does not have.
 * Better to say so than to open the wrong Mac's Finder.
 */
const UNAVAILABLE = new Set([
  "open_path",
  "reveal_in_finder",
  "open_in_editor",
  "open_in_custom_editor",
]);

/** Prefixes that always stay on the client, whatever the host would answer. */
const CLIENT_PREFIXES = [
  // Pairing, revocation and gateway config are this Mac's root of trust.
  "remote_",
  // The client updates itself; `updater_get_state` on the host is not useful here.
  "updater_",
  // Telemetry is keyed to this install.
  "telemetry_",
];

export function commandTarget(command: string): CommandTarget {
  if (UNAVAILABLE.has(command)) {
    return "unavailable";
  }
  if (CLIENT_EXECUTED.has(command)) {
    return "client";
  }
  if (CLIENT_PREFIXES.some((p) => command.startsWith(p))) {
    return "client";
  }
  // Anything else the protocol bars from the wire has no client fallback.
  if (HOST_ONLY_COMMANDS.has(command)) {
    return "unavailable";
  }

  return "host";
}
