import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstNameOf,
  formatIsoDate,
  formatTimestampDate,
  initialsFor,
  teamLabelFor,
  toIsoDate,
} from "./names.ts";

test("initials come from the first two words", () => {
  assert.equal(initialsFor("Asha Patel"), "AP");
  assert.equal(initialsFor("palanivel kumar singh"), "PK");
});

test("a single name gives its first two letters", () => {
  assert.equal(initialsFor("Palanivel"), "PA");
});

test("initials are taken across separators, not just spaces", () => {
  assert.equal(initialsFor("asha.patel"), "AP");
  assert.equal(initialsFor("asha_patel"), "AP");
  assert.equal(initialsFor("asha-patel"), "AP");
});

// --- the team label, derived from the leader's preferred name ----------------------

test("a team is labelled by the first word of the leader's preferred name", () => {
  assert.equal(teamLabelFor("Gopinath J"), "Gopinath's Team");
  assert.equal(teamLabelFor("Palani Kumar"), "Palani's Team");
  assert.equal(teamLabelFor("Palanivel"), "Palanivel's Team");
});

test("the label uses only the first word, however many the name has", () => {
  assert.equal(teamLabelFor("Asha Patel Kumar Singh"), "Asha's Team");
});

test("surrounding and repeated whitespace does not reach the label", () => {
  assert.equal(teamLabelFor("   Gopinath    J   "), "Gopinath's Team");
  assert.equal(teamLabelFor("Asha\tPatel"), "Asha's Team");
  assert.equal(teamLabelFor("Asha\nPatel"), "Asha's Team");
});

test("a hyphenated or dotted first name stays whole", () => {
  // Only whitespace separates words here, unlike `initialsFor`.
  assert.equal(teamLabelFor("Anna-Maria Rossi"), "Anna-Maria's Team");
  assert.equal(teamLabelFor("J.R. Patel"), "J.R.'s Team");
});

test("a name with nothing usable in it gives no label rather than a malformed one", () => {
  // The caller shows its own fallback; "'s Team" must never reach a screen.
  assert.equal(teamLabelFor(""), null);
  assert.equal(teamLabelFor("   "), null);
  assert.equal(teamLabelFor("\n\t "), null);
  assert.equal(teamLabelFor(null), null);
  assert.equal(teamLabelFor(undefined), null);
});

test("an unusual name is labelled rather than rejected", () => {
  assert.equal(teamLabelFor("李"), "李's Team");
  assert.equal(teamLabelFor("O'Brien Family"), "O'Brien's Team");
  assert.equal(teamLabelFor("123 Team"), "123's Team");
});

test("the first name is the first whitespace-separated word", () => {
  assert.equal(firstNameOf("Gopinath J"), "Gopinath");
  assert.equal(firstNameOf("  Palanivel  "), "Palanivel");
  assert.equal(firstNameOf(""), "");
  assert.equal(firstNameOf("   "), "");
});

test("an ISO date keeps its calendar day when formatted", () => {
  // Parsed at local noon, so no timezone can push it to the previous day.
  const formatted = formatIsoDate("2026-01-05");
  assert.match(formatted, /2026/);
  assert.ok(!formatted.includes("4"), formatted);
});

test("something that is not a date is shown as given rather than as Invalid Date", () => {
  assert.equal(formatIsoDate("not-a-date"), "not-a-date");
});

test("a date becomes an ISO day in the device's own timezone", () => {
  assert.equal(toIsoDate(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toIsoDate(new Date(2026, 10, 12)), "2026-11-12");
});

test("single-digit months and days are padded", () => {
  assert.equal(toIsoDate(new Date(2026, 8, 9)), "2026-09-09");
});

test("an ISO day survives a round trip through both helpers", () => {
  const date = new Date(2026, 2, 1, 23, 45);
  assert.equal(toIsoDate(date), "2026-03-01");
  assert.match(formatIsoDate(toIsoDate(date)), /2026/);
});

test("a timestamp is named by the device's own calendar day, not by UTC's", () => {
  // An instant, unlike a joining date: whichever day the device is on is the right
  // answer, which is exactly what slicing the ISO string would get wrong.
  const instant = new Date(2026, 10, 12, 9, 30);

  assert.equal(formatTimestampDate(instant.toISOString()), formatIsoDate("2026-11-12"));
});

test("an unreadable timestamp is shown as given rather than as Invalid Date", () => {
  assert.equal(formatTimestampDate("not-a-timestamp"), "not-a-timestamp");
});
