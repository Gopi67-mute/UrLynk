import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFailure } from "./failure.ts";

const FALLBACK = "We couldn't load your team numbers";

test("a dropped connection is reported as being offline, and is worth retrying", () => {
  const failure = describeFailure("network", FALLBACK);

  assert.equal(failure.kind, "offline");
  assert.equal(failure.title, "You appear to be offline");
  assert.equal(failure.canRetry, true);
});

test("a request that timed out is offline too, with its own wording", () => {
  const failure = describeFailure("timeout", FALLBACK);

  assert.equal(failure.kind, "offline");
  assert.match(failure.message, /too long/);
  assert.equal(failure.canRetry, true);
});

test("an ended session is not a connectivity problem, and retrying is not offered", () => {
  const failure = describeFailure("unauthorized", FALLBACK);

  assert.equal(failure.kind, "session");
  assert.equal(failure.title, "Your session has ended");
  assert.match(failure.message, /sign in again/i);
  assert.equal(failure.canRetry, false);
});

test("a forbidden request is told apart from an expired session", () => {
  const failure = describeFailure("forbidden", FALLBACK);

  assert.equal(failure.kind, "session");
  assert.notEqual(failure.title, "Your session has ended");
  assert.equal(failure.canRetry, false);
});

test("a rejected request is never described as a network failure", () => {
  const failure = describeFailure("validation", FALLBACK);

  assert.equal(failure.kind, "rejected");
  assert.doesNotMatch(failure.message, /connection/i);
  // The same request would be refused the same way, so another attempt is not offered.
  assert.equal(failure.canRetry, false);
});

test("a missing record says so, rather than inviting a pointless retry", () => {
  const failure = describeFailure("not_found", FALLBACK);

  assert.equal(failure.kind, "rejected");
  assert.equal(failure.canRetry, false);
});

test("something that changed underneath can be retried after a refresh", () => {
  const failure = describeFailure("conflict", FALLBACK);

  assert.equal(failure.kind, "rejected");
  assert.equal(failure.canRetry, true);
});

test("a backend that is down is a server failure, and is worth retrying", () => {
  const unavailable = describeFailure("unavailable", FALLBACK);
  const broken = describeFailure("server", FALLBACK);

  assert.equal(unavailable.kind, "server");
  assert.equal(unavailable.canRetry, true);
  assert.equal(broken.kind, "server");
  assert.equal(broken.canRetry, true);
  // A 500 is not something this function can describe better than the screen can.
  assert.equal(broken.title, FALLBACK);
});

test("a misconfigured app says so instead of blaming the connection", () => {
  const failure = describeFailure("config", FALLBACK);

  assert.equal(failure.kind, "config");
  assert.equal(failure.canRetry, false);
});

test("a failure that is not an API error keeps the screen's own headline", () => {
  const failure = describeFailure(null, FALLBACK);

  assert.equal(failure.kind, "unknown");
  assert.equal(failure.title, FALLBACK);
  assert.equal(failure.canRetry, true);
});

test("the three kinds a dashboard must not confuse stay distinct", () => {
  const offline = describeFailure("network", FALLBACK);
  const rejected = describeFailure("validation", FALLBACK);
  const session = describeFailure("unauthorized", FALLBACK);

  const kinds = new Set([offline.kind, rejected.kind, session.kind]);
  assert.equal(kinds.size, 3);
  const titles = new Set([offline.title, rejected.title, session.title]);
  assert.equal(titles.size, 3);
});
