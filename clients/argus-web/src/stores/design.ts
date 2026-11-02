/**
 * Figma frames for the design viewer, kept per link so moving between a
 * file's frames and back is instant. Mirrors `DesignViewerModel`; comparisons
 * are snapshots and stay with the screen.
 */

import { describeError, NOT_CONNECTED_MESSAGE } from "@argus/client-core";
import { RemoteError } from "@argus/remote-client";
import type {
  DesignComparison,
  FigmaFrameDetails,
} from "@argus/remote-protocol";
import { create } from "zustand";
import type { RemotePlatform } from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

export interface FrameLoad {
  details: FigmaFrameDetails | null;
  error: string | null;
}

interface DesignState {
  frames: Record<string, FrameLoad>;

  loadFrame: (url: string) => Promise<void>;
  compare: (
    url: string,
    platform: RemotePlatform,
    deviceKey: string,
  ) => Promise<DesignComparison>;
}

export const FIGMA_NOT_CONNECTED =
  "Connect Figma in Argus on your computer to open designs here.";

/** The host's errors, with "connect it in Settings" pointed at the computer. */
export function designErrorMessage(error: unknown): string {
  const message = describeError(error);

  return /figma isn.t connected/i.test(message) ? FIGMA_NOT_CONNECTED : message;
}

export const useDesignStore = create<DesignState>()((set) => ({
  frames: {},

  loadFrame: async (url) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    let load: FrameLoad;
    try {
      const { details } = await request(t, "figma.frame_details", { url });
      load = {
        details,
        error: details ? null : "Figma has no frame at this link.",
      };
    } catch (error) {
      load = { details: null, error: designErrorMessage(error) };
    }
    set((s) => ({ frames: { ...s.frames, [url]: load } }));
  },

  compare: async (url, platform, deviceKey) => {
    const t = currentTransport();
    if (!t) {
      throw new RemoteError("offline", NOT_CONNECTED_MESSAGE);
    }
    const { comparison } = await request(t, "design.compare", {
      url,
      platform,
      device_key: deviceKey,
    });

    return comparison;
  },
}));
