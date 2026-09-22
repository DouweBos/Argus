/**
 * Huddle rooms: a temporary link that lets a guest talk to one agent and drive
 * one device, for as long as the engineer keeps the room open.
 *
 * The rule the whole feature rests on: **the token grants nothing.** Opening
 * the link gets a browser a socket and a pending guest record — no agent, no
 * transcript, no device. The host approving is what mints the scoped grant,
 * bound to the ephemeral key that browser handshook with.
 *
 * `huddle.*` is therefore deliberately *not* in `REMOTE_METHODS`: those all
 * need a capability tier, and a pending guest has none. They are handled on the
 * connection itself, like `transfer.*`.
 */

import { z } from "zod";

/** Methods a guest socket may call. Handled pre-`dispatch`, ungated by tier. */
export const HUDDLE_METHODS = [
  "huddle.join",
  "huddle.say",
  "huddle.state",
  "huddle.typing",
] as const;
export type HuddleMethod = (typeof HUDDLE_METHODS)[number];

export function isHuddleMethod(value: string): value is HuddleMethod {
  return (HUDDLE_METHODS as readonly string[]).includes(value);
}

/** Where a guest stands with the host. Stored per guest, per room. */
export const HuddleGuestState = z.enum(["pending", "approved", "denied"]);
export type HuddleGuestState = z.infer<typeof HuddleGuestState>;

/** What a guest's connection reports — its guest state, plus "the room is gone". */
export const HuddleConnectionState = z.enum([
  "pending",
  "approved",
  "denied",
  "ended",
]);
export type HuddleConnectionState = z.infer<typeof HuddleConnectionState>;

export const HuddleJoinParams = z.object({
  /** The high-entropy token carried in the link. */
  token: z.string().min(1).max(256),
  /** Display name the host sees in "… wants to join". */
  label: z.string().trim().min(1).max(64).optional(),
  /**
   * Stable per-browser id, so closing the tab and coming back updates the
   * person already in the host's list instead of adding a second row with the
   * same name. Purely an identity hint — it grants nothing, and the guest still
   * needs approving, because the key the grant binds to is new.
   */
  client_id: z.string().trim().min(1).max(128).optional(),
});
export type HuddleJoinParams = z.infer<typeof HuddleJoinParams>;

/**
 * "I am composing something." Presence only — it carries no text, so a draft
 * never leaves the browser that is writing it. The host expires the flag on its
 * own (see `TYPING_TTL_MS`), so a guest whose socket dies mid-sentence stops
 * showing as typing without anyone having to send the `false`.
 */
export const HuddleTypingParams = z.object({
  typing: z.boolean(),
});
export type HuddleTypingParams = z.infer<typeof HuddleTypingParams>;

/** The longest thing anyone can say in one go. A side chat, not an essay. */
export const HUDDLE_CHAT_MAX = 2000;

export const HuddleSayParams = z.object({
  text: z.string().trim().min(1).max(HUDDLE_CHAT_MAX),
});
export type HuddleSayParams = z.infer<typeof HuddleSayParams>;

/**
 * One line in the room's side chat — what the people in the huddle say to each
 * other, as opposed to what they say to the agent.
 *
 * Never reaches the agent: it is not in its transcript, not in its context, and
 * not in anything it can read. "Try it on the iPad" is a note to a colleague,
 * not a prompt.
 */
export const HuddleChatMessage = z.object({
  id: z.string(),
  /** Display name as it stood when they sent it. */
  author: z.string(),
  /** Who said it, or null when the host did — they have no member row. */
  member_id: z.string().nullable(),
  text: z.string(),
  at: z.number(),
});
export type HuddleChatMessage = z.infer<typeof HuddleChatMessage>;

/**
 * Chat arriving at a guest. `replace` distinguishes the backlog handed over on
 * approval from the single message appended when someone speaks, so a client
 * never has to guess whether to concatenate or start again.
 */
export const HuddleChatPayload = z.object({
  room_id: z.string(),
  messages: z.array(HuddleChatMessage),
  replace: z.boolean().default(false),
});
export type HuddleChatPayload = z.infer<typeof HuddleChatPayload>;

/**
 * One other person in the room, as a guest sees them. Deliberately thin: a
 * display name and whether they are here right now. Never the key they
 * handshook with or the browser id they presented — a guest has no business
 * identifying another guest's hardware.
 */
export const HuddleMember = z.object({
  /** Opaque per-room id, stable across the member reopening the link. */
  member_id: z.string(),
  label: z.string(),
  connected: z.boolean(),
  /** They hold the device claim. At most one member ever does. */
  driving: z.boolean().default(false),
  /** They are composing a message to the agent right now. */
  typing: z.boolean().default(false),
});
export type HuddleMember = z.infer<typeof HuddleMember>;

/**
 * The guest's own view of where it stands. `agent_id`/`device_key`/`members`
 * stay empty until approval — a pending guest is not told what it is waiting
 * for, nor who else is already inside.
 */
export const HuddleStatePayload = z.object({
  room_id: z.string(),
  state: HuddleConnectionState,
  agent_id: z.string().nullable(),
  device_key: z.string().nullable(),
  /** Everyone the host has let in. Empty for anyone not approved themselves. */
  members: z.array(HuddleMember).default([]),
  /** Which of `members` is the recipient, so a client can mark "you". */
  you: z.string().nullable().default(null),
  /**
   * The engineer is composing. They are not a member — they own the room — so
   * their typing rides alongside the roster rather than in it.
   */
  host_typing: z.boolean().default(false),
  /** What to call the engineer, so a guest reads a name and not "the host". */
  host_label: z.string().default(""),
});
export type HuddleStatePayload = z.infer<typeof HuddleStatePayload>;

export const HuddleMethodParams = {
  "huddle.join": HuddleJoinParams,
  "huddle.say": HuddleSayParams,
  "huddle.state": z.object({}),
  "huddle.typing": HuddleTypingParams,
} as const satisfies Record<HuddleMethod, z.ZodTypeAny>;

export const HuddleMethodResult = {
  "huddle.join": HuddleStatePayload,
  "huddle.say": z.object({}),
  "huddle.state": HuddleStatePayload,
  "huddle.typing": z.object({}),
} as const satisfies Record<HuddleMethod, z.ZodTypeAny>;

// --- Host-side views (the desktop's own UI, not the wire) -------------------

/** One guest in a room, as the host's guest list renders it. */
export interface HuddleGuest {
  /**
   * Opaque per-room identity, minted on first join and kept when they reopen
   * the link. What guests see each other by, so neither the Noise key nor the
   * browser id has to travel between them.
   */
  member_id: string;
  /** Ephemeral X25519 public key the browser generated for this visit. */
  dev_static_pub: string;
  /**
   * Stable per-browser id this guest last presented, when they sent one. What
   * the list is deduped on: the key above changes every tab, this doesn't.
   */
  client_id: string | null;
  label: string;
  state: HuddleGuestState;
  joined_at: number;
  approved_at: number | null;
  /** Whether their socket is live right now (they may reload the tab). */
  connected: boolean;
  /** Composing a message right now. Expires on its own — see `TYPING_TTL_MS`. */
  typing: boolean;
}

/**
 * A live share. In memory only — a crash or a quit ends every room, which is
 * the intended fail-safe, so there is no persisted counterpart to this type.
 */
export interface HuddleRoom {
  id: string;
  /** High-entropy token carried in the link. Grants nothing on its own. */
  token: string;
  /** The one agent guests may talk to. */
  agent_id: string;
  /** The device guests may drive; empty when the host had none open. */
  device_key: string;
  /** The shareable link, once a public URL is up. */
  url: string | null;
  created_at: number;
  /** Backstop only — the engineer normally ends the huddle by hand. */
  expires_at: number;
  guests: HuddleGuest[];
  /** The engineer is composing. Mirrored to guests, never persisted. */
  host_typing: boolean;
  /**
   * What the engineer is called in this room: on their own messages, and in
   * the typing line. Empty when the desktop couldn't work out a name, which
   * the clients render as "the host".
   */
  host_label: string;
  /** The room's side chat, newest last. Bounded — see `CHAT_BACKLOG`. */
  chat: HuddleChatMessage[];
}
