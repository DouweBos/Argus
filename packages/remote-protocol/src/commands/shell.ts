import { z } from "zod";
import {
  CameraAccessStatus,
  PopoutPlatform,
  UpdaterState,
} from "../models/shell";
import { type CommandSpec, NoParams, Void } from "./spec";

/**
 * Window-, dialog- and updater-bound commands the desktop shell registers. A
 * headless host has none of these.
 */
export const SHELL_COMMANDS = {
  close_window: { tier: "host", params: NoParams, result: Void },
  /**
   * The renderer accepted the quit-with-running-agents prompt: stop them
   * (bounded) and quit.
   */
  app_confirm_quit: { tier: "admin", params: NoParams, result: Void },
  app_cancel_quit: { tier: "admin", params: NoParams, result: Void },
  /** Reading the host's update status is remotable; acting on it is not. */
  updater_get_state: { tier: "admin", params: NoParams, result: UpdaterState },
  updater_check: {
    tier: "host",
    params: z.object({ silent: z.boolean().optional() }),
    result: UpdaterState,
  },
  updater_download: { tier: "host", params: NoParams, result: Void },
  updater_quit_and_install: { tier: "host", params: NoParams, result: Void },
  /** `name` is only needed for video inputs, which the backend can't list. */
  open_device_popout: {
    tier: "admin",
    tool: "device-recording",
    params: z.object({
      platform: PopoutPlatform,
      deviceKey: z.string(),
      name: z.string().optional(),
    }),
    result: Void,
  },
  close_device_popout: {
    tier: "admin",
    tool: "device-recording",
    params: z.object({ platform: PopoutPlatform, deviceKey: z.string() }),
    result: Void,
  },
  open_agent_popout: {
    tier: "host",
    params: z.object({
      agentId: z.string(),
      sessionId: z.string(),
      title: z.string().optional(),
      /** Screen coords of the drop cursor, if a drag triggered it. */
      cursorX: z.number().optional(),
      cursorY: z.number().optional(),
    }),
    result: Void,
  },
  close_agent_popout: {
    tier: "host",
    params: z.object({ agentId: z.string() }),
    result: Void,
  },
  /**
   * Advertise the session on screen to the paired phone over Handoff, or stop
   * (`sessionId: null`).
   */
  publish_handoff: {
    tier: "host",
    params: z.object({
      sessionId: z.string().nullable(),
      agentId: z.string().optional(),
      label: z.string().optional(),
      projectName: z.string().optional(),
      repoRoot: z.string().optional(),
    }),
    result: Void,
  },
  list_popped_out_agents: {
    tier: "admin",
    params: NoParams,
    result: z.array(z.string()),
  },
  request_camera_access: {
    tier: "admin",
    params: NoParams,
    result: CameraAccessStatus,
  },
  show_image_context_menu: {
    tier: "host",
    params: z.object({ src: z.string(), suggestedName: z.string().optional() }),
    result: Void,
  },
  show_open_dialog: {
    tier: "host",
    params: z.object({ title: z.string().optional() }),
    result: z.string().nullable(),
  },
} as const satisfies Record<string, CommandSpec>;
