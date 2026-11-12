import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateJoiningDate,
  validateMiLifestyleId,
  validateName,
  validateNotes,
  validatePhoneNumber,
} from "./validation.ts";

// These mirror the backend's rules. The backend decides; this only saves a round trip.

test("a name is required", () => {
  assert.ok(validateName(""));
  assert.ok(validateName("   "));
  assert.equal(validateName("Palanivel"), null);
});

test("a name is length limited", () => {
  assert.equal(validateName("A".repeat(120)), null);
  assert.ok(validateName("A".repeat(121)));
});

test("a Mi Lifestyle ID is required", () => {
  assert.ok(validateMiLifestyleId(""));
  assert.ok(validateMiLifestyleId("   "));
});

test("a Mi Lifestyle ID of exactly ten digits is accepted", () => {
  assert.equal(validateMiLifestyleId("1234567890"), null);
  assert.equal(validateMiLifestyleId("0000000000"), null);
});

test("a Mi Lifestyle ID keeps its leading zeros and is not treated as a number", () => {
  // The whole point: "0012345678" must not become 12345678 anywhere in the app.
  assert.equal(validateMiLifestyleId("0012345678"), null);
});

test("surrounding whitespace is trimmed before the ten digits are counted", () => {
  assert.equal(validateMiLifestyleId("  1234567890  "), null);
});

test("fewer than ten digits is rejected", () => {
  assert.ok(validateMiLifestyleId("123456789"));
  assert.ok(validateMiLifestyleId("1"));
});

test("more than ten digits is rejected", () => {
  assert.ok(validateMiLifestyleId("12345678901"));
});

test("too short and too long are told apart", () => {
  // The user is told which mistake they made, not just that something is wrong.
  assert.notEqual(validateMiLifestyleId("123456789"), validateMiLifestyleId("12345678901"));
});

test("anything that is not a digit is rejected, however long", () => {
  assert.ok(validateMiLifestyleId("ML-00123/A"));
  assert.ok(validateMiLifestyleId("HAHAHAHAH"));
  assert.ok(validateMiLifestyleId("12345U7890"));
  assert.ok(validateMiLifestyleId("001 234567"));
  assert.ok(validateMiLifestyleId("001\t234567"));
});

test("non-ASCII digits are not digits", () => {
  // Ten characters that `isdigit` would accept but a Mi Lifestyle ID is not made of.
  assert.ok(validateMiLifestyleId("١٢٣٤٥٦٧٨٩٠"));
});

test("a phone number is optional but must look like one", () => {
  assert.equal(validatePhoneNumber(""), null);
  assert.equal(validatePhoneNumber("+91 98765 43210"), null);
  assert.equal(validatePhoneNumber("(044) 2345-6789"), null);
  assert.ok(validatePhoneNumber("call me"));
  assert.ok(validatePhoneNumber("12345"), "five digits is too few");
  assert.ok(validatePhoneNumber("1".repeat(33)));
});

test("notes are length limited", () => {
  assert.equal(validateNotes(""), null);
  assert.equal(validateNotes("A".repeat(500)), null);
  assert.ok(validateNotes("A".repeat(501)));
});

test("a joining date is optional", () => {
  assert.equal(validateJoiningDate(null), null);
});

test("a joining date cannot be in the future", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);
  assert.ok(validateJoiningDate(tomorrow));
});

test("today is an acceptable joining date in any timezone", () => {
  assert.equal(validateJoiningDate(new Date()), null);
});

test("a joining date before 2000 is rejected as a typo", () => {
  assert.ok(validateJoiningDate(new Date(1999, 11, 31)));
  assert.equal(validateJoiningDate(new Date(2000, 0, 1)), null);
});
