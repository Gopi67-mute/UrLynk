import assert from "node:assert/strict";
import { test } from "node:test";
import { startupGate, type StartupSignals } from "./startup-gate.ts";

/** A cold start with nothing resolved yet. */
const launching: StartupSignals = {
  fontsReady: false,
  authLoaded: false,
  isSignedIn: false,
  storedSession: false,
  authTimedOut: false,
};

function gate(overrides: Partial<StartupSignals>) {
  return startupGate({ ...launching, ...overrides });
}

test("nothing is drawn before the fonts are ready", () => {
  const first = gate({ fontsReady: false });
  assert.equal(first.shellReady, false);
  assert.equal(first.slowAuthNotice, false);
});

// The white screen this gate exists to remove: on a first install Clerk has no cached
// environment or client, so `isLoaded` waits on the network — and the public shell used
// to wait with it.
test("a first install shows the public shell as soon as the fonts are ready", () => {
  const first = gate({ fontsReady: true, authLoaded: false, storedSession: false });
  assert.equal(first.shellReady, true);
  assert.equal(first.publicRoutes, true);
  assert.equal(first.privateRoutes, false);
});

test("a device with no stored session never waits for Clerk to answer", () => {
  // Offline, so Clerk's network-dependent load will not resolve at all. Onboarding and
  // the authentication screens still render.
  const offline = gate({ fontsReady: true, authLoaded: false, storedSession: false });
  assert.equal(offline.shellReady, true);
});

test("a device that holds a session waits for Clerk rather than flashing onboarding", () => {
  const restoring = gate({ fontsReady: true, authLoaded: false, storedSession: true });
  assert.equal(restoring.shellReady, false);
  assert.equal(restoring.publicRoutes, false);
  assert.equal(restoring.privateRoutes, false);
});

test("private screens open only once Clerk has confirmed the identity", () => {
  const confirmed = gate({ fontsReady: true, authLoaded: true, isSignedIn: true });
  assert.equal(confirmed.privateRoutes, true);
  assert.equal(confirmed.publicRoutes, false);
  assert.equal(confirmed.shellReady, true);
});

// The mistake that would put one leader's cached team in front of another: treating an
// unresolved `isSignedIn` as a yes.
test("an unconfirmed identity never opens a private screen", () => {
  for (const storedSession of [false, true]) {
    for (const authTimedOut of [false, true]) {
      const unconfirmed = gate({
        fontsReady: true,
        authLoaded: false,
        isSignedIn: true,
        storedSession,
        authTimedOut,
      });
      assert.equal(unconfirmed.privateRoutes, false);
    }
  }
});

test("Clerk confirming a signed-out session opens the public shell", () => {
  const signedOut = gate({
    fontsReady: true,
    authLoaded: true,
    isSignedIn: false,
    storedSession: true,
  });
  assert.equal(signedOut.publicRoutes, true);
  assert.equal(signedOut.privateRoutes, false);
  assert.equal(signedOut.shellReady, true);
});

test("the shell is never rendered with neither half enabled", () => {
  for (const fontsReady of [false, true]) {
    for (const authLoaded of [false, true]) {
      for (const isSignedIn of [false, true]) {
        for (const storedSession of [false, true]) {
          for (const authTimedOut of [false, true]) {
            const result = startupGate({
              fontsReady,
              authLoaded,
              isSignedIn,
              storedSession,
              authTimedOut,
            });
            if (result.shellReady) {
              assert.ok(
                result.privateRoutes || result.publicRoutes,
                "a rendered shell always has somewhere to go",
              );
            }
          }
        }
      }
    }
  }
});

test("a session restore that never finishes says so after the timeout", () => {
  const stuck = gate({
    fontsReady: true,
    authLoaded: false,
    storedSession: true,
    authTimedOut: true,
  });
  assert.equal(stuck.slowAuthNotice, true);
  assert.equal(stuck.shellReady, false);
});

test("the timeout notice stays hidden while the splash is still the right thing to show", () => {
  const waiting = gate({ fontsReady: true, authLoaded: false, storedSession: true });
  assert.equal(waiting.slowAuthNotice, false);
});

test("a timeout that fires after Clerk answered is not reported as a problem", () => {
  const late = gate({
    fontsReady: true,
    authLoaded: true,
    isSignedIn: true,
    storedSession: true,
    authTimedOut: true,
  });
  assert.equal(late.slowAuthNotice, false);
  assert.equal(late.shellReady, true);
});
