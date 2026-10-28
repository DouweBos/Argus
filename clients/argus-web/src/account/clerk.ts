/**
 * Clerk JS for the hosted client. Loaded from the instance's frontend API at
 * one pinned version with Subresource Integrity, so a changed bundle fails to
 * load instead of running; the CSP allows scripts only from this origin, that
 * frontend API and Cloudflare Turnstile (Clerk's bot check).
 */

import type { AccountAuth } from "./session";

/** Bump both together: the hash is of `dist/clerk.browser.js` in this npm version. */
export const CLERK_JS_VERSION = "5.128.1";
export const CLERK_JS_INTEGRITY =
  "sha384-GpRJv2HyaO/k/gGXDuz7JGje1Fi8IlJziMrg39G2mi5Bw6Foi6mBC3iIxYVDsLmA";

export interface ClerkJs {
  load: (options?: Record<string, unknown>) => Promise<void>;
  user: unknown;
  session: { getToken: () => Promise<string | null> } | null;
  mountSignIn: (node: HTMLDivElement, props?: Record<string, unknown>) => void;
  unmountSignIn: (node: HTMLDivElement) => void;
  addListener: (cb: (resources: { user?: unknown }) => void) => () => void;
  signOut: () => Promise<void>;
}

declare global {
  interface Window {
    Clerk?: ClerkJs;
  }
}

export function clerkScriptUrl(frontendApi: string): string {
  return `${frontendApi.replace(/\/+$/, "")}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`;
}

/** Peacock's tokens as Clerk appearance variables, so its form matches the app. */
function appearance(): Record<string, unknown> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  return {
    variables: {
      colorPrimary: read("--accent"),
      colorBackground: read("--bg-secondary"),
      colorText: read("--text-primary"),
      colorTextSecondary: read("--text-secondary"),
      colorInputBackground: read("--bg-primary"),
      colorInputText: read("--text-primary"),
    },
  };
}

export async function loadClerk(config: {
  clerk_publishable_key: string;
  frontend_api: string;
}): Promise<ClerkJs> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = clerkScriptUrl(config.frontend_api);
    script.integrity = CLERK_JS_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.dataset.clerkPublishableKey = config.clerk_publishable_key;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("clerk"));
    document.head.appendChild(script);
  });
  const clerk = window.Clerk;
  if (!clerk) {
    throw new Error("clerk");
  }
  await clerk.load({ appearance: appearance(), telemetry: false });

  return clerk;
}

export function clerkAuth(clerk: ClerkJs): AccountAuth {
  return {
    isSignedIn: () => !!clerk.user,
    token: async () => (await clerk.session?.getToken()) ?? null,
    signOut: () => clerk.signOut(),
  };
}
