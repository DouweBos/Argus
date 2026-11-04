import { useEffect, useRef } from "react";
import { Spinner } from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { clerkAppearance } from "../account/clerk";

/** Clerk's own sign-in form; signing in lands back here and the account store picks it up. */
export function SignInScreen() {
  const clerk = useAccountStore((s) => s.clerk);
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = node.current;
    if (!clerk || !target) {
      return;
    }
    const here = window.location.href;
    // Read the tokens per mount, so a theme switch since load is picked up.
    clerk.mountSignIn(target, {
      appearance: clerkAppearance(),
      withSignUp: true,
      forceRedirectUrl: here,
      signUpForceRedirectUrl: here,
    });

    return () => clerk.unmountSignIn(target);
  }, [clerk]);

  return (
    <div className="aw-auth-card">
      {!clerk && (
        <div className="aw-center">
          <Spinner size="sm" />
        </div>
      )}
      {/* Clerk owns this node's children; React never renders into it. */}
      <div className="aw-auth-signin" ref={node} />
    </div>
  );
}
