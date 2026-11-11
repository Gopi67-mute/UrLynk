import { useClerk } from "@clerk/expo";
import { useRef, useState } from "react";

/** Ending the session is enough: the root layout's guards handle the navigation. */
export function useSignOut() {
  const { signOut } = useClerk();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  // State updates land after the next render, too late to stop a double tap.
  const signOutInFlight = useRef(false);

  async function requestSignOut() {
    if (signOutInFlight.current) return;

    signOutInFlight.current = true;
    setIsSigningOut(true);
    setSignOutFailed(false);
    try {
      await signOut();
    } catch (error) {
      console.error(
        "[auth] Sign-out failed:",
        error instanceof Error ? error.name : "unknown error",
      );
      setSignOutFailed(true);
    } finally {
      signOutInFlight.current = false;
      setIsSigningOut(false);
    }
  }

  return { requestSignOut, isSigningOut, signOutFailed };
}
