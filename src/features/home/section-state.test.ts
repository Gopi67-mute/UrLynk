import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionState, sectionStateFor } from "./section-state.ts";

test("a first request in flight shows the loading face", () => {
  assert.equal(sectionState({ isPending: true, isError: false, count: null }), "loading");
});

test("a failed request shows the error face, with nothing invented in its place", () => {
  assert.equal(sectionState({ isPending: false, isError: true, count: null }), "error");
});

test("a failure is never dressed up as an empty team", () => {
  // A cached-but-stale empty list plus a failed refresh must still read as a failure:
  // "No members added yet" would be a claim about the team that nobody verified.
  assert.equal(sectionState({ isPending: false, isError: true, count: 0 }), "error");
});

test("an answer of zero items is empty, once the request has succeeded", () => {
  assert.equal(sectionState({ isPending: false, isError: false, count: 0 }), "empty");
});

test("items that came back are rendered", () => {
  assert.equal(sectionState({ isPending: false, isError: false, count: 5 }), "ready");
});

test("no answer yet is loading, even when the query is not reporting pending", () => {
  // A query that is disabled — before the account is known — reports neither pending nor
  // data. Reading that as an empty team would flash "nothing here" on every cold start.
  assert.equal(sectionState({ isPending: false, isError: false, count: null }), "loading");
});

test("a first load with nothing cached shows skeletons", () => {
  assert.equal(sectionStateFor("first-load", null), "loading");
});

// What this section used to get wrong on a cold start: a list that never arrived was
// shown as a skeleton forever. A previously synchronized list is shown instead.
test("a previously synchronized list is shown whatever the connection is doing", () => {
  assert.equal(sectionStateFor("offline-stale", 5), "ready");
  assert.equal(sectionStateFor("refresh-failed", 5), "ready");
  assert.equal(sectionStateFor("refreshing", 5), "ready");
  assert.equal(sectionStateFor("ready", 5), "ready");
});

// Neither of the alternatives is true: this leader's team is not empty, and nothing
// went wrong.
test("offline with nothing cached is neither empty nor an error", () => {
  assert.equal(sectionStateFor("offline-empty", null), "offline");
});

test("a failure with nothing cached is still an error", () => {
  assert.equal(sectionStateFor("failed", null), "error");
  assert.equal(sectionStateFor("signed-out", null), "error");
});

test("a team with genuinely nobody added reads as empty, once a request succeeded", () => {
  assert.equal(sectionStateFor("ready", 0), "empty");
  assert.equal(sectionStateFor("offline-stale", 0), "empty");
});
