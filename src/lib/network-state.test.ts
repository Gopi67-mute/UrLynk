import assert from "node:assert/strict";
import { test } from "node:test";
import { isOnlineFrom } from "./network-state.ts";

test("connected with the internet reachable is online", () => {
  assert.equal(isOnlineFrom({ isConnected: true, isInternetReachable: true }), true);
});

test("not connected to anything is offline", () => {
  assert.equal(isOnlineFrom({ isConnected: false, isInternetReachable: false }), false);
  assert.equal(isOnlineFrom({ isConnected: false, isInternetReachable: true }), false);
});

// A phone firmly attached to a café's Wi-Fi that leads nowhere. Where Android has
// actually checked and says no, that is the answer.
test("connected to a network that reaches nothing is offline", () => {
  assert.equal(isOnlineFrom({ isConnected: true, isInternetReachable: false }), false);
});

// Android reports this as unknown often, including while it is still checking. Calling
// that offline would put an offline notice on the screen every time a network changed.
test("connected with reachability unknown is treated as online", () => {
  assert.equal(isOnlineFrom({ isConnected: true, isInternetReachable: null }), true);
  assert.equal(isOnlineFrom({ isConnected: true }), true);
});

test("no reading at all is offline", () => {
  assert.equal(isOnlineFrom(null), false);
  assert.equal(isOnlineFrom(undefined), false);
  assert.equal(isOnlineFrom({}), false);
});
