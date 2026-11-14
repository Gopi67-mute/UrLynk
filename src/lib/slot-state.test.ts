import assert from "node:assert/strict";
import { test } from "node:test";
import { slotState, slotStateFor } from "./slot-state.ts";

const member = { id: "m1" };

test("a filled position reports the member in it", () => {
  assert.equal(slotState(false, null, member), "filled");
});

test("a position with nothing in it is open", () => {
  assert.equal(slotState(false, null, null), "open");
});

test("a position still being loaded is not called open", () => {
  assert.equal(slotState(true, null, null), "loading");
});

test("a failed request leaves the position unavailable, never open", () => {
  // Drawing it as open would invite a placement into a slot that may be taken.
  assert.equal(slotState(false, new Error("offline"), null), "unavailable");
});

test("a failure is reported even while a dependent request still reads as pending", () => {
  // A disabled query reports `pending` forever, so pending must not win here.
  assert.equal(slotState(true, new Error("offline"), null), "unavailable");
});

test("a first load with nothing cached shows a position as loading", () => {
  assert.equal(slotStateFor("first-load", null), "loading");
});

// The point of caching the team: positions saved last time are real positions, and a
// missing connection is a reason to say when they were saved, not to hide them.
test("previously synchronized positions stay readable offline", () => {
  assert.equal(slotStateFor("offline-stale", member), "filled");
  assert.equal(slotStateFor("offline-stale", null), "open");
});

test("a position stays readable while its refresh is in flight or has failed", () => {
  assert.equal(slotStateFor("refreshing", member), "filled");
  assert.equal(slotStateFor("refresh-failed", member), "filled");
  assert.equal(slotStateFor("ready", null), "open");
});

test("a position nobody has ever loaded is unavailable, never open", () => {
  // Still the original rule: drawing an unknown position as open invites a placement
  // into a slot that may already be taken.
  assert.equal(slotStateFor("offline-empty", null), "unavailable");
  assert.equal(slotStateFor("failed", null), "unavailable");
  assert.equal(slotStateFor("signed-out", member), "unavailable");
});
