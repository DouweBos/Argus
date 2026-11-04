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
  session: {
    getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>;
  } | null;
  /** Clerk's "verify it's you" modal; the hooks are how it reports back. */
  __internal_openReverification?: (props: {
    level?: "first_factor" | "second_factor" | "multi_factor";
    afterVerification?: () => void;
    afterVerificationCancelled?: () => void;
  }) => void;
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

/**
 * Peacock's tokens as Clerk appearance. Variables must be literal colours
 * (Clerk derives shades from them); `elements` take CSS, so they use tokens.
 * Clerk's own card chrome is dropped — the page's card frames the form.
 */
export function clerkAppearance(): Record<string, unknown> {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const dark = root.dataset.theme !== "light";

  return {
    variables: {
      colorPrimary: read("--accent"),
      colorTextOnPrimaryBackground: read("--accent-fg"),
      colorDanger: read("--error"),
      colorSuccess: read("--success"),
      colorWarning: read("--warning"),
      // Borders, dividers and hover fills are shades of this; Clerk's default is black.
      colorNeutral: read("--text-primary"),
      colorBackground: read("--bg-secondary"),
      colorText: read("--text-primary"),
      colorTextSecondary: read("--text-secondary"),
      colorInputBackground: read("--bg-primary"),
      colorInputText: read("--text-primary"),
      fontFamily: read("--font-ui"),
      fontSize: "14px",
      borderRadius: "8px",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: {
        width: "100%",
        maxWidth: "none",
        boxShadow: "none",
        border: "none",
        borderRadius: 0,
        background: "transparent",
      },
      card: {
        background: "transparent",
        boxShadow: "none",
        border: "none",
        padding: "28px 28px 24px",
      },
      headerTitle: { fontSize: "17px", fontWeight: 600 },
      socialButtonsBlockButton: {
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        boxShadow: "none",
        color: "var(--text-primary)",
      },
      socialButtonsBlockButtonText: { color: "var(--text-primary)" },
      // Clerk ships these marks black; its own dark theme inverts them the same way.
      socialButtonsProviderIcon__github: dark ? { filter: "invert(1)" } : {},
      socialButtonsProviderIcon__apple: dark ? { filter: "invert(1)" } : {},
      dividerLine: { background: "var(--border)" },
      dividerText: { color: "var(--text-muted)" },
      formFieldInput: {
        border: "1px solid var(--border)",
        boxShadow: "none",
      },
      formButtonPrimary: {
        background: "var(--accent)",
        color: "var(--accent-fg)",
        boxShadow: "none",
        border: "none",
        "&:hover, &:focus": { background: "var(--accent-hover)" },
      },
      footer: {
        background: "var(--surface-2)",
        borderTop: "1px solid var(--border-subtle)",
      },
      footerActionLink: { color: "var(--accent)" },
    },
  };
}

/** The page already says "Sign in to Argus"; the card says which account. */
const CLERK_LOCALIZATION = {
  signIn: {
    start: {
      // `*Combined` is what the form shows with sign-up enabled.
      titleCombined: "Use your Argus account",
      subtitleCombined: "The one you signed in with on your iPhone or Mac.",
    },
  },
};

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
  await clerk.load({
    appearance: clerkAppearance(),
    localization: CLERK_LOCALIZATION,
    telemetry: false,
  });

  return clerk;
}

/** Opens Clerk's reverification modal; resolves true once the user verified. */
export function clerkReverify(clerk: ClerkJs): Promise<boolean> {
  const open = clerk.__internal_openReverification;
  if (!open) {
    return Promise.reject(
      new Error(
        "Couldn't ask you to verify it's you. Sign out, sign in again, and delete the account within 10 minutes.",
      ),
    );
  }

  return new Promise((resolve) => {
    open.call(clerk, {
      level: "first_factor",
      afterVerification: () => resolve(true),
      afterVerificationCancelled: () => resolve(false),
    });
  });
}

export function clerkAuth(clerk: ClerkJs): AccountAuth {
  return {
    isSignedIn: () => !!clerk.user,
    token: async () => (await clerk.session?.getToken()) ?? null,
    signOut: () => clerk.signOut(),
    reverify: () => clerkReverify(clerk),
  };
}
