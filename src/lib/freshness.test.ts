import assert from "node:assert/strict";
import { test } from "node:test";
import { lastSyncedText } from "./freshness.ts";

const NOW = 1_770_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function text(ageMs: number) {
  return lastSyncedText(NOW - ageMs, NOW);
}

test("anything under a minute reads as just now", () => {
  assert.equal(text(0), "Updated just now");
  assert.equal(text(59_000), "Updated just now");
});

test("minutes are counted, and one of them is singular", () => {
  assert.equal(text(MINUTE), "Updated 1 minute ago");
  assert.equal(text(4 * MINUTE), "Updated 4 minutes ago");
  assert.equal(text(59 * MINUTE), "Updated 59 minutes ago");
});

test("an hour or more is counted in hours", () => {
  assert.equal(text(HOUR), "Updated 1 hour ago");
  assert.equal(text(5 * HOUR + 30 * MINUTE), "Updated 5 hours ago");
  assert.equal(text(23 * HOUR), "Updated 23 hours ago");
});

// The warning end of the ladder: this is what a leader sees after a few days away with
// no connection, and it should read as old rather than as a time of day.
test("a day or more is counted in days", () => {
  assert.equal(text(DAY), "Updated 1 day ago");
  assert.equal(text(6 * DAY), "Updated 6 days ago");
});

test("a screen with no recorded time says nothing rather than guessing", () => {
  assert.equal(lastSyncedText(null, NOW), null);
  assert.equal(lastSyncedText(undefined, NOW), null);
  assert.equal(lastSyncedText(0, NOW), null);
});

// A device whose clock moved backwards would otherwise produce "Updated -3 minutes ago".
test("a time in the future reads as just now", () => {
  assert.equal(lastSyncedText(NOW + 5 * MINUTE, NOW), "Updated just now");
});
