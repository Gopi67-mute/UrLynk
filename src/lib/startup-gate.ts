/**
 * What the app is allowed to draw during its first second.
 *
 * The decision this makes is narrow but easy to get wrong, so it lives here as a pure
 * function with its own tests rather than inside the root layout's render.
 *
 * The question is *when* each half of the navigator may appear:
 *
 * - **Private routes** — the tabs, member screens, and the cached team behind them —
 *   may appear only once Clerk has confirmed *which* leader this is. Never before, and
 *   never on a guess. This is the rule that keeps one leader's team off another's
 *   screen, and nothing below is allowed to relax it.
 * - **Public routes** — onboarding and the authentication screens — carry no private
 *   data at all. They need to know only one thing: that there is no signed-in session
 *   to send the user past them. A device that has never held a session cannot have one
 *   now, and that is a local fact, not a network one.
 *
 * That asymmetry is the whole point. The app used to wait for Clerk's `isLoaded` before
 * rendering *anything*, and on a first install `isLoaded` is network-dependent: the SDK
 * has no cached environment or client to start from, so it has to reach Clerk's servers
 * first. Measured at 1.7–2.3 s with a connection, and it does not resolve at all without
 * one. The native splash was released as soon as the fonts were ready, so what filled
 * that gap was a blank screen — the white screen this gate exists to remove.
 *
 * `storedSession` is what makes it safe: a single bit, read synchronously from the device
 * (see `session-hint.ts`), saying whether this device held a Clerk session the last time
 * the app looked. When it is false there is nothing to wait for and the public shell is
 * drawn immediately. When it is true the app waits, exactly as it did before — but that
 * wait is now Clerk reading its own snapshot off the device, not a round trip.
 */

export type StartupSignals = {
  /** The app's fonts have loaded, failed, or run out of patience. */
  readonly fontsReady: boolean;
  /** Clerk has settled and `isSignedIn` is now an answer rather than a guess. */
  readonly authLoaded: boolean;
  /** Clerk's answer. Meaningless until `authLoaded`. */
  readonly isSignedIn: boolean;
  /**
   * Whether this device held a Clerk session the last time the app knew.
   *
   * False means "cannot be signed in", which is why it is allowed to unblock the public
   * shell. It is never allowed to unblock a private one: only Clerk can do that.
   */
  readonly storedSession: boolean;
  /** The defensive five-second authentication timeout has fired. */
  readonly authTimedOut: boolean;
};

export type StartupGate = {
  /**
   * Render the navigator. False means the native splash is still the right thing to be
   * looking at, and the app is waiting for something it genuinely needs.
   */
  readonly shellReady: boolean;
  /** Authenticated screens, and the cached team data behind them. */
  readonly privateRoutes: boolean;
  /** Onboarding and the authentication screens. */
  readonly publicRoutes: boolean;
  /**
   * Show the "still connecting" holding screen instead of the splash.
   *
   * The dead end this covers: a device that holds a session whose restore never
   * finishes. Silence would be the splash forever, so after the timeout the app says
   * what it is waiting for.
   */
  readonly slowAuthNotice: boolean;
};

export function startupGate(signals: StartupSignals): StartupGate {
  const { fontsReady, authLoaded, isSignedIn, storedSession, authTimedOut } = signals;

  // Only a confirmed identity opens the private half. `isSignedIn` is undefined while
  // Clerk is settling, and reading that as "signed in" is the one mistake that would
  // put a stranger's cached team on screen.
  const privateRoutes = authLoaded && isSignedIn;

  // The public half needs the opposite: proof that nobody is signed in. Clerk saying so
  // is proof; a device with no stored session is proof as well, and it is proof the app
  // already has in hand before the first frame.
  const publicRoutes = authLoaded ? !isSignedIn : !storedSession;

  // Rendering the navigator with neither half enabled would be an empty `Stack`, which
  // is a blank screen by another route. Deriving readiness from the halves themselves
  // makes that state unreachable rather than merely unlikely.
  const shellReady = fontsReady && (privateRoutes || publicRoutes);

  return {
    shellReady,
    privateRoutes,
    publicRoutes,
    slowAuthNotice: fontsReady && !shellReady && authTimedOut && !authLoaded,
  };
}
