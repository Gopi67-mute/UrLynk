import assert from "node:assert/strict";
import { test } from "node:test";
import type { MemberDetail } from "../../api/members.ts";
import { changedFields, formFromMember, hasUnsavedChanges } from "./profile-changes.ts";

function member(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    id: "m1",
    name: "Asha Patel",
    mi_lifestyle_id: null,
    placement_position: null,
    is_root: true,
    joining_date: null,
    created_at: "2026-01-01T00:00:00Z",
    photo_updated_at: null,
    has_left_child: false,
    has_right_child: false,
    phone_number: null,
    notes: null,
    placement_parent: null,
    sponsor: null,
    ...overrides,
  };
}

test("an untouched form sends nothing at all", () => {
  const saved = member({
    mi_lifestyle_id: "0012345",
    phone_number: "9876543210",
    joining_date: "2024-03-01",
    notes: "Weekly training",
  });

  assert.deepEqual(changedFields(formFromMember(saved), saved), {});
  assert.equal(hasUnsavedChanges(formFromMember(saved), saved), false);
});

test("only the fields the user changed are sent", () => {
  const saved = member({ mi_lifestyle_id: "0012345", phone_number: "9876543210" });
  const form = { ...formFromMember(saved), name: "Asha P." };

  assert.deepEqual(changedFields(form, saved), { name: "Asha P." });
});

test("an emptied optional field is sent as null, which is the request to clear it", () => {
  const saved = member({ notes: "Something", phone_number: "9876543210" });
  const form = { ...formFromMember(saved), notes: "", phoneNumber: "   " };

  assert.deepEqual(changedFields(form, saved), { notes: null, phone_number: null });
});

test("a name is never sent as null, and an empty one is simply not sent", () => {
  const saved = member();
  const form = { ...formFromMember(saved), name: "   " };

  // Clearing a name is a validation error on the screen, not a request to the API.
  assert.deepEqual(changedFields(form, saved), {});
});

test("surrounding whitespace is not a change", () => {
  const saved = member({ mi_lifestyle_id: "0012345" });
  const form = { ...formFromMember(saved), name: "  Asha Patel  ", miLifestyleId: " 0012345 " };

  assert.deepEqual(changedFields(form, saved), {});
});

test("a Mi Lifestyle ID keeps its leading zeros through a round trip", () => {
  const saved = member({ mi_lifestyle_id: "000987" });

  assert.equal(formFromMember(saved).miLifestyleId, "000987");
  assert.deepEqual(
    changedFields({ ...formFromMember(saved), miLifestyleId: "0012345" }, saved),
    { mi_lifestyle_id: "0012345" },
  );
});

test("the profile fields that remain are each sent under their own API field", () => {
  const saved = member();
  const form = {
    ...formFromMember(saved),
    miLifestyleId: "0012345",
    phoneNumber: "9876543210",
    notes: "Prefers calls after 6pm",
  };

  assert.deepEqual(changedFields(form, saved), {
    mi_lifestyle_id: "0012345",
    phone_number: "9876543210",
    notes: "Prefers calls after 6pm",
  });
});

test("the removed qualifications and priorities fields are gone from the form entirely", () => {
  const form = formFromMember(member());

  for (const removed of [
    "educationalQualifications",
    "professionalQualifications",
    "priorities",
    "goals",
  ]) {
    assert.ok(!(removed in form), `${removed} must no longer be part of the form`);
  }
});

test("a joining date can be set and cleared", () => {
  const empty = member();
  assert.deepEqual(changedFields({ ...formFromMember(empty), joiningDate: "2024-03-01" }, empty), {
    joining_date: "2024-03-01",
  });

  const dated = member({ joining_date: "2024-03-01" });
  assert.deepEqual(changedFields({ ...formFromMember(dated), joiningDate: null }, dated), {
    joining_date: null,
  });
});

test("a sponsor can be changed and cleared, and is read from the member's sponsor", () => {
  const sponsored = member({
    sponsor: {
      id: "s1",
      name: "Palanivel",
      mi_lifestyle_id: null,
      placement_position: "LEFT",
      is_root: false,
      joining_date: null,
      created_at: "2026-01-01T00:00:00Z",
      photo_updated_at: null,
    },
  });

  assert.equal(formFromMember(sponsored).sponsorId, "s1");
  assert.deepEqual(changedFields({ ...formFromMember(sponsored), sponsorId: null }, sponsored), {
    sponsor_id: null,
  });
  assert.deepEqual(changedFields({ ...formFromMember(sponsored), sponsorId: "s2" }, sponsored), {
    sponsor_id: "s2",
  });
});

test("nothing structural is ever included in an edit", () => {
  const saved = member({ placement_position: "LEFT", is_root: false, photo_updated_at: "t" });
  const form = { ...formFromMember(saved), name: "Renamed", notes: "Edited" };

  const sent = Object.keys(changedFields(form, saved));

  for (const forbidden of [
    "id",
    "team_id",
    "is_root",
    "placement_position",
    "placement_parent_id",
    "photo_updated_at",
    "created_at",
  ]) {
    assert.ok(!sent.includes(forbidden), `${forbidden} must never be sent`);
  }
});

test("unsaved changes are reported as soon as one field differs", () => {
  const saved = member();

  assert.equal(hasUnsavedChanges(formFromMember(saved), saved), false);
  assert.equal(hasUnsavedChanges({ ...formFromMember(saved), notes: "x" }, saved), true);
});
