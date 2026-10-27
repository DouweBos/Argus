/** The two waits of an EAS session start: which project it runs under, and until it is ready. */

import type { EasHostConfig } from "./config";
import type { ExpoApi } from "./expoApi";
import { EasError } from "./credential";

/** The host's project, or the account's only one. */
export async function resolveAppId(
  api: ExpoApi,
  config: EasHostConfig,
): Promise<string> {
  if (config.appId) {
    return config.appId;
  }
  const { apps } = await api.viewer();
  if (apps.length === 1) {
    return apps[0].id;
  }
  throw new EasError(
    "no_app",
    apps.length === 0
      ? "The Expo account has no EAS project to run sessions under. Create one with `eas init`."
      : `Choose the EAS project for ${config.label} in Settings → Tools → Device hosts (Check account lists them).`,
  );
}

export interface AwaitRunningOptions {
  isCancelled: () => boolean;
  cancelled: () => Error;
  deadline: number;
  now: () => number;
  pollMs: number;
  /** Hands out a wake that cuts the current wait short (a cancel). */
  onWait: (wake: (() => void) | null) => void;
}

/** Poll until the session runs and has a preview host; a few failed polls are tolerated. */
export async function awaitRunning(
  api: ExpoApi,
  sessionId: string,
  opts: AwaitRunningOptions,
): Promise<{ url: string; token: string }> {
  let transient = 0;
  for (;;) {
    if (opts.isCancelled()) {
      throw opts.cancelled();
    }
    if (opts.now() > opts.deadline) {
      throw new EasError(
        "timeout",
        "The EAS Simulator session did not start in time.",
      );
    }
    try {
      const session = await api.session(sessionId);
      transient = 0;
      if (session.status === "STOPPED" || session.status === "ERRORED") {
        throw new EasError(
          "session_ended",
          `The EAS Simulator session ended (${session.status}) before it was ready.`,
        );
      }
      if (session.status === "IN_PROGRESS" && session.preview) {
        return session.preview;
      }
    } catch (e) {
      // One failed request during a minutes-long start does not end the start.
      if (
        !(e instanceof EasError) ||
        e.failure === "session_ended" ||
        e.rejected ||
        ++transient > 3
      ) {
        throw e;
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, opts.pollMs);
      opts.onWait(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    opts.onWait(null);
  }
}
