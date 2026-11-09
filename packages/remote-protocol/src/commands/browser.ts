import { z } from "zod";
import {
  BrowserDevtools,
  BrowserElement,
  BrowserElementHit,
  BrowserPreset,
} from "../models/browser";
import { type CommandSpec, NoParams, Void } from "./spec";

const BrowserSession = z.object({ sessionId: z.string() });

// A Conductor-backed Chromium per session. Commands against a session with no
// browser reserved resolve without doing anything.
export const BROWSER_COMMANDS = {
  /** Reserves a browser, starts the screencast, emits `browser:ensure_mounted`. */
  browser_view_ensure: { tier: "admin", params: BrowserSession, result: Void },
  /** The navigation commands emit `browser_view:nav` with the new state. */
  browser_view_navigate: {
    tier: "admin",
    params: BrowserSession.extend({ url: z.string() }),
    result: Void,
  },
  browser_view_back: { tier: "admin", params: BrowserSession, result: Void },
  browser_view_forward: { tier: "admin", params: BrowserSession, result: Void },
  browser_view_reload: { tier: "admin", params: BrowserSession, result: Void },
  browser_view_destroy: { tier: "admin", params: BrowserSession, result: Void },
  browser_mouse_event: {
    tier: "admin",
    tool: "device-control",
    params: BrowserSession.extend({
      type: z.enum(["click", "down", "move", "up"]),
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "middle", "right"]).optional(),
    }),
    result: Void,
  },
  browser_keyboard_event: {
    tier: "admin",
    tool: "device-control",
    params: BrowserSession.extend({
      type: z.enum(["down", "press", "up"]),
      key: z.string(),
    }),
    result: Void,
  },
  browser_wheel_event: {
    tier: "admin",
    tool: "device-control",
    params: BrowserSession.extend({
      x: z.number(),
      y: z.number(),
      deltaX: z.number(),
      deltaY: z.number(),
    }),
    result: Void,
  },
  browser_update_preset: {
    tier: "admin",
    params: BrowserSession.extend({ preset: BrowserPreset }),
    result: Void,
  },
  /**
   * The session browser's DevTools endpoints; null with no browser reserved.
   * Host tier: they are loopback addresses, useless and unsafe off this machine.
   */
  browser_devtools: {
    tier: "host",
    params: BrowserSession,
    result: BrowserDevtools.nullable(),
  },
  /**
   * The element at a point, for the picker's hover. `x`/`y` are 0–1 across
   * the viewport, so callers needn't know its CSS size. Null over nothing.
   */
  browser_element_at: {
    tier: "admin",
    tool: "device-control",
    params: BrowserSession.extend({ x: z.number(), y: z.number() }),
    result: BrowserElementHit.nullable(),
  },
  /** The element at a point in full, with a cropped screenshot, to attach to chat. */
  browser_pick_element: {
    tier: "admin",
    tool: "device-control",
    params: BrowserSession.extend({ x: z.number(), y: z.number() }),
    result: BrowserElement.nullable(),
  },
  /** Port of the local MJPEG server the screencast frames are served from. */
  browser_get_mjpeg_port: {
    tier: "admin",
    params: NoParams,
    result: z.number(),
  },
} as const satisfies Record<string, CommandSpec>;
