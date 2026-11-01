/// <reference types="vite/client" />

/** The Argus version this bundle shipped with (root `package.json`). */
declare const __ARGUS_VERSION__: string;

interface ImportMetaEnv {
  /** PostHog project key; without one the client sends nothing. */
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
