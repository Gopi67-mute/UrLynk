import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canWrite,
  hasVisibleData,
  needsFreshnessNotice,
  screenState,
  worseOf,
  type ScreenStateInput,
} from "./screen-state.ts";

function state(overrides: Partial<ScreenStateInput>) {
  return screenState({
    hasData: false,
    isFetching: false,
    isError: false,
    failure: null,
    isOnline: true,
    ...overrides,
  });
}

test("nothing cached and a request on its way is the first load", () => {
  assert.equal(state({ isFetching: true }), "first-load");
});

// The state this whole milestone exists to produce: a dashboard that was cached last
// time appears immediately, and the refresh happens underneath it.
test("cached data with a refresh in flight shows the data, not a spinner", () => {
  assert.equal(state({ hasData: true, isFetching: true }), "refreshing");
  assert.ok(hasVisibleData("refreshing"));
});

test("cached data with nothing in flight is simply ready", () => {
  assert.equal(state({ hasData: true }), "ready");
});

// Reporting the failed request instead of the missing connection is what made the app
// blame itself for a tunnel.
test("offline outranks the error it caused", () => {
  assert.equal(
    state({ hasData: true, isError: true, failure: "offline", isOnline: false }),
    "offline-stale",
  );
  assert.equal(
    state({ hasData: false, isError: true, failure: "offline", isOnline: false }),
    "offline-empty",
  );
});

test("offline with nothing cached says so rather than showing an empty team", () => {
  assert.equal(state({ isOnline: false }), "offline-empty");
});

test("a failed refresh keeps the cached data on screen", () => {
  assert.equal(state({ hasData: true, isError: true, failure: "server" }), "refresh-failed");
  assert.ok(hasVisibleData("refresh-failed"));
});

test("a failure with nothing cached is a failure", () => {
  assert.equal(state({ isError: true, failure: "server" }), "failed");
  assert.equal(hasVisibleData("failed"), false);
});

// Cached numbers belong to a session that no longer exists. Showing them as the
// leader's current team would be a claim nobody can stand behind.
test("an ended session outranks everything, cached data included", () => {
  assert.equal(state({ hasData: true, isError: true, failure: "session" }), "signed-out");
  assert.equal(
    state({ hasData: true, failure: "session", isOnline: false }),
    "signed-out",
  );
  assert.equal(hasVisibleData("signed-out"), false);
});

test("only the states that could be out of date carry a freshness notice", () => {
  assert.ok(needsFreshnessNotice("offline-stale"));
  assert.ok(needsFreshnessNotice("refresh-failed"));

  for (const quiet of ["ready", "refreshing", "first-load", "offline-empty", "failed"] as const) {
    assert.equal(needsFreshnessNotice(quiet), false, quiet);
  }
});

// A refresh already in flight is not a reason to tell anyone anything: the data is
// current as far as anyone knows, and something is being done about it.
test("a background refresh does not put a warning over the screen", () => {
  assert.equal(needsFreshnessNotice("refreshing"), false);
});

test("writes are allowed only with a connection, and are never queued", () => {
  assert.equal(canWrite(true), true);
  assert.equal(canWrite(false), false);
});

// Home's branch cards need two requests. One of them not arriving is enough to make the
// pair something other than current, and the screen must say so.
test("a screen made of two requests reports the worse of the two", () => {
  assert.equal(worseOf("ready", "refreshing"), "refreshing");
  assert.equal(worseOf("refreshing", "ready"), "refreshing");
  assert.equal(worseOf("ready", "offline-empty"), "offline-empty");
  assert.equal(worseOf("first-load", "ready"), "first-load");
  assert.equal(worseOf("refresh-failed", "offline-stale"), "offline-stale");
  assert.equal(worseOf("signed-out", "ready"), "signed-out");
});

test("two ready requests make a ready screen", () => {
  assert.equal(worseOf("ready", "ready"), "ready");
});
