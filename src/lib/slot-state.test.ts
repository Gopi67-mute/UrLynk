import assert from "node:assert/strict";
import { test } from "node:test";
import { slotState } from "./slot-state.ts";

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
