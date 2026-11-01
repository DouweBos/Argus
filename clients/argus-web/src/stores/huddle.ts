/**
 * A huddle guest's side of the room. A tab opened on a huddle link never
 * pairs: it handshakes with an ephemeral key, presents the token and waits
 * for the host to approve it, on a socket of its own.
 */

import { create } from "zustand";
import { Transport } from "@argus/remote-client";
import {
  fetchHostKey,
  guestClientId,
  guestKeypair,
  readGuestLabel,
  rememberGuestLabel,
} from "../lib/huddleIdentity";
import {
  applyHuddleChat,
  applyHuddleState,
  huddleCapabilities,
  INITIAL_HUDDLE_VIEW,
  requestJoin,
  type HuddleView,
} from "../lib/huddleSession";
import { wsOrigin } from "../lib/origin";
import type { HuddleChatPayload, HuddleStatePayload } from "../lib/protocol";
import { request } from "../lib/request";
import {
  connectionHooks,
  currentTransport,
  media,
  useConnectionStore,
} from "./connection";

interface HuddleState {
  /** Guest standing; null for a paired device. The two never mix in one tab. */
  huddle: HuddleView | null;

  /**
   * Open a huddle link: handshake with an ephemeral key, present the token,
   * then sit pending until the host approves. The socket is upgraded in
   * place, so there is no second connection.
   */
  joinHuddle: (token: string, label: string) => Promise<void>;
  /** Hang up from the guest side. The link still works after. */
  leaveHuddle: () => void;
  /** Say something to the room. Never reaches the agent. */
  sayInHuddle: (text: string) => void;
  /**
   * Change the name the room sees. Re-presents the token on the same key, so
   * the grant survives and nobody has to approve the guest a second time.
   */
  renameInHuddle: (label: string) => void;
  /**
   * Tell the room we are (or are no longer) composing. Presence only: the
   * draft never leaves this browser, and a drop expires the flag host-side.
   */
  setHuddleTyping: (typing: boolean) => void;
}

// The room this tab is in, so a rename can re-present the same token.
let huddleToken: string | null = null;

/** Our standing changed: the grant follows it. */
function adoptView(view: HuddleView): void {
  useHuddleStore.setState({ huddle: view });
  useConnectionStore.setState({ capabilities: huddleCapabilities(view.state) });
}

/**
 * A guest's socket. Leaner than a paired one: a guest has no device record
 * to rename, no push subscription and no parked decisions, and no
 * capabilities at all until the host approves it.
 */
function connectGuest(
  token: string,
  label: string,
  hostPubB64: string,
): Transport {
  const { privB64, pubB64 } = guestKeypair(token);
  const transport = new Transport(
    { url: wsOrigin(), devPrivB64: privB64, devPubB64: pubB64, hostPubB64 },
    {
      onState: (connection) => {
        useConnectionStore.setState({ connection });
        if (connection !== "ready") {
          return;
        }
        // Re-present the token on every (re)connect: an approved key is
        // re-granted silently, so a reload costs no second approval.
        requestJoin(
          transport,
          token,
          readGuestLabel() || label,
          useHuddleStore.getState().huddle ?? undefined,
          guestClientId(),
        )
          .then((view) => {
            adoptView(view);
            // A refusal and a dead link are both final; retrying the join on
            // every reconnect would only spin.
            if (view.state === "denied" || view.state === "unavailable") {
              transport.disconnect();
            }
          })
          .catch(() => {});
      },
      onEvent: (event) => connectionHooks().event(event),
      onMedia: (bytes) => media.push(bytes),
    },
  );
  transport.connect();

  return transport;
}

export const useHuddleStore = create<HuddleState>()((set, get) => ({
  huddle: null,

  joinHuddle: async (token, label) => {
    huddleToken = token;
    useConnectionStore.getState().adopt(null);
    set({ huddle: INITIAL_HUDDLE_VIEW });
    useConnectionStore.setState({ capabilities: [], identity: null });
    try {
      const hostPubB64 = await fetchHostKey();
      useConnectionStore
        .getState()
        .adopt(connectGuest(token, label, hostPubB64));
    } catch {
      // No key published means no open room: the link is dead, not broken.
      set((s) => ({
        huddle: { ...(s.huddle ?? INITIAL_HUDDLE_VIEW), state: "unavailable" },
      }));
    }
  },

  sayInHuddle: (text) => {
    const t = currentTransport();
    if (get().huddle?.state !== "approved" || !t) {
      return;
    }
    request(t, "huddle.say", { text }).catch(() => {});
  },

  renameInHuddle: (label) => {
    const name = label.trim();
    if (!name) {
      return;
    }
    rememberGuestLabel(name);
    const { transport, connection } = useConnectionStore.getState();
    if (!transport || !huddleToken || connection !== "ready") {
      return;
    }
    requestJoin(
      transport,
      huddleToken,
      name,
      get().huddle ?? undefined,
      guestClientId(),
    )
      .then(adoptView)
      .catch(() => {});
  },

  setHuddleTyping: (typing) => {
    const t = currentTransport();
    if (get().huddle?.state !== "approved" || !t) {
      return;
    }
    request(t, "huddle.typing", { typing }).catch(() => {});
  },

  leaveHuddle: () => {
    // Dropping the socket is what tells the host. Keep the view so the gate
    // can offer to go back in.
    useConnectionStore.getState().adopt(null);
    useConnectionStore.setState({ capabilities: [] });
    set((s) => ({
      huddle: { ...(s.huddle ?? INITIAL_HUDDLE_VIEW), state: "left" },
    }));
  },
}));

/** `huddle.chat`: someone said something to the room. */
export function receiveHuddleChat(payload: HuddleChatPayload): void {
  useHuddleStore.setState((s) => ({
    huddle: s.huddle ? applyHuddleChat(payload, s.huddle) : s.huddle,
  }));
}

/**
 * `huddle.state`: approval upgrades this very socket, so the grant arrives
 * as an event rather than a reconnect. Denied and ended are terminal.
 */
export function receiveHuddleState(payload: HuddleStatePayload): void {
  const view = applyHuddleState(
    payload,
    useHuddleStore.getState().huddle ?? undefined,
  );
  adoptView(view);
  if (view.state === "denied" || view.state === "ended") {
    // The host drops the socket right after. Stop dialling: a guest turned
    // away should read that, not a reconnect spinner.
    currentTransport()?.disconnect();
  }
}
