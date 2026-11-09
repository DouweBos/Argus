import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Build-time constants both bundles share. `VITE_POSTHOG_KEY` /
 * `VITE_POSTHOG_HOST` win; `POSTHOG_KEY` / `POSTHOG_HOST` (the host's, which CI
 * sets) are accepted too, as `build-host.mjs` does. Neither is a secret: a
 * PostHog project key only lets you send events.
 */
export function webDefines(): Record<string, string> {
  const root = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
  ) as { version: string };

  return {
    __ARGUS_VERSION__: JSON.stringify(root.version),
    "import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(
      process.env.VITE_POSTHOG_KEY ?? process.env.POSTHOG_KEY ?? "",
    ),
    "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(
      process.env.VITE_POSTHOG_HOST ?? process.env.POSTHOG_HOST ?? "",
    ),
  };
}
