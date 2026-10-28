import { useEffect, useRef } from "react";
import { useAccountStore } from "../account/accountStore";

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
    clerk.mountSignIn(target, {
      withSignUp: true,
      forceRedirectUrl: here,
      signUpForceRedirectUrl: here,
    });

    return () => clerk.unmountSignIn(target);
  }, [clerk]);

  return (
    <>
      <p className="aw-muted">
        Use the account you signed in with on the Argus app. A device already on
        it approves this browser once, then your computers are a click away.
      </p>
      <div className="aw-hosted-signin" ref={node} />
    </>
  );
}
