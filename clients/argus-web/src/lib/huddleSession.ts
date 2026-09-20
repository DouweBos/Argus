/**
 * The guest half of a huddle, as a plain state machine over the two methods a
 * pending connection may call (`huddle.join`, `huddle.state`) and the one event
 * it receives (`huddle.state`).
 *
 * Transport-agnostic so it can be reasoned about — and tested — without a
 * socket. The rule it encodes: until the host approves, the client knows the
 * room id and nothing else, and holds no capabilities, so it must offer nothing.
 */

import type { HuddleStatePayload } from "./protocol";

/**
 * Where the guest stands. `connecting` covers the socket and the join round
 * trip; `unavailable` is a link that names no open room.
 */
export type HuddleState =
  | "approved"
  | "connecting"
  | "denied"
  | "ended"
  | "pending"
  | "unavailable";

export interface HuddleView {
  state: HuddleState;
  roomId: string | null;
  /** The one agent this guest may talk to; null until approved. */
  agentId: string | null;
  /** The one device this guest may drive; null until approved. */
  deviceKey: string | null;
}

export const INITIAL_HUDDLE_VIEW: HuddleView = {
  state: "connecting",
  roomId: null,
  agentId: null,
  deviceKey: null,
};

/** What the host can tell us, folded into our view. */
export function applyHuddleState(payload: HuddleStatePayload): HuddleView {
  return {
    state: payload.state,
    roomId: payload.room_id,
    agentId: payload.agent_id,
    deviceKey: payload.device_key,
  };
}

/**
 * A rejected `huddle.join`. Only two answers are final: the host said no, or
 * the link names no room. Anything else is the connection having a bad day, so
 * we stay `connecting` and let the reconnect retry rather than declaring the
 * huddle over.
 */
export function applyJoinFailure(code: string, prev: HuddleView): HuddleView {
  if (code === "capability_denied") {
    return { ...prev, state: "denied" };
  }
  if (code === "not_found") {
    return { ...prev, state: "unavailable" };
  }

  return { ...prev, state: "connecting" };
}

export interface HuddleRequester {
  request: <T>(method: string, params: unknown) => Promise<T>;
}

/** Present the token. A key already approved for this room comes back approved. */
export async function requestJoin(
  transport: HuddleRequester,
  token: string,
  label: string,
  prev: HuddleView = INITIAL_HUDDLE_VIEW,
  clientId?: string,
): Promise<HuddleView> {
  try {
    const payload = await transport.request<HuddleStatePayload>("huddle.join", {
      token,
      label,
      ...(clientId ? { client_id: clientId } : {}),
    });

    return applyHuddleState(payload);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "unknown";

    return applyJoinFailure(code, prev);
  }
}

/**
 * The grants a guest holds. Empty until approved — the host refuses everything
 * anyway, and the client must not render an affordance it cannot use.
 */
export function huddleCapabilities(state: HuddleState): string[] {
  return state === "approved" ? ["monitor", "control"] : [];
}

/** Screens a guest may open. There is no third one: no projects, no sessions. */
export type HuddlePane = "agent" | "device";

/**
 * The panes an approved guest gets. The device pane needs a simulator the
 * client can stream; a `browser:` claim key names an embedded browser, which
 * this client cannot render, so the huddle is transcript-only.
 */
export function huddlePanes(view: HuddleView): HuddlePane[] {
  if (view.state !== "approved" || !view.agentId) {
    return [];
  }

  return view.deviceKey && !view.deviceKey.startsWith("browser:")
    ? ["agent", "device"]
    : ["agent"];
}
