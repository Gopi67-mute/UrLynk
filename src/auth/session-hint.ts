/**
 * One bit, kept on the device: did this device hold a Clerk session last time?
 *
 * It exists so the app can answer "could this launch be a signed-in launch?" *before*
 * the first frame, without asking Clerk and therefore without waiting on the network.
 * `startup-gate.ts` explains what that answer unlocks; this file is only the storage.
 *
 * What it is not:
 *
 * - **Not an identity.** The stored value is `"1"` or `"0"`. It names no account, holds
 *   no token, and cannot be used to show anybody's data. Only Clerk's confirmed answer
 *   opens a private screen, and that is enforced in the gate, not here.
 * - **Not a session.** It never grants access to anything. A device whose hint says
 *   `"1"` with no real session simply waits for Clerk and is then shown onboarding.
 *
 * SecureStore rather than a plain store because `getItem` is synchronous there, which is
 * the entire requirement: an asynchronous read would cost the frame this is meant to
 * save. The value is not a secret, but it sits next to Clerk's own session storage,
 * which is the right neighbourhood for it to be cleared from.
 */

import * as SecureStore from "expo-secure-store";

const HINT_KEY = "urlynk.device-held-session";

const HELD = "1";
const NONE = "0";

/** The value in storage, read at most once per launch. */
let cached: string | null | undefined;

/**
 * Whether a signed-in session may be waiting to be restored on this device.
 *
 * Absent means no: a device that has never written the hint has never completed a
 * sign-in through this build, and the public shell is safe to draw at once. A read that
 * throws means yes — SecureStore being unavailable is no reason to risk showing
 * onboarding to a leader who is signed in, and waiting is what the app did before.
 */
export function deviceHeldSession(): boolean {
  try {
    if (cached === undefined) cached = SecureStore.getItem(HINT_KEY);
    return cached === HELD;
  } catch (error: unknown) {
    console.warn("[auth] Could not read the stored session hint:", error);
    return true;
  }
}

/**
 * Record what Clerk has just confirmed, for the next launch.
 *
 * Called only once Clerk has settled, so the bit always reflects a real answer. Writes
 * are skipped when nothing changed: this runs on every launch, and the common case is
 * that the device is in the same state it was in yesterday.
 */
export function rememberSession(hasSession: boolean): void {
  const next = hasSession ? HELD : NONE;
  if (cached === next) return;

  cached = next;
  SecureStore.setItemAsync(HINT_KEY, next).catch((error: unknown) => {
    console.warn("[auth] Could not store the session hint:", error);
  });
}
