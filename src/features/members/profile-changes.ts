import type { MemberDetail, MemberUpdate } from "@/api/members";

/**
 * The editable profile, as the form holds it.
 *
 * Text fields are always strings, never null, because that is what a `TextInput`
 * works with. Turning "" back into an explicit null — the request to clear a field —
 * happens in `changedFields`, in one place.
 */
export type ProfileForm = {
  name: string;
  miLifestyleId: string;
  phoneNumber: string;
  /** ISO date (YYYY-MM-DD), or null when none is recorded. */
  joiningDate: string | null;
  notes: string;
  sponsorId: string | null;
};

/** Which form field maps to which API field. The single list both directions use. */
const TEXT_FIELDS = [
  ["miLifestyleId", "mi_lifestyle_id"],
  ["phoneNumber", "phone_number"],
  ["notes", "notes"],
] as const satisfies readonly (readonly [keyof ProfileForm, keyof MemberUpdate])[];

export function formFromMember(member: MemberDetail): ProfileForm {
  return {
    name: member.name,
    miLifestyleId: member.mi_lifestyle_id ?? "",
    phoneNumber: member.phone_number ?? "",
    joiningDate: member.joining_date,
    notes: member.notes ?? "",
    sponsorId: member.sponsor?.id ?? null,
  };
}

/**
 * Exactly what the user changed, in the shape PATCH expects.
 *
 * Sending only the differences is what makes an edit safe to make from a screen that
 * was opened a while ago: a field nobody touched is left out, so it keeps whatever is
 * stored rather than being overwritten with what the form happened to load.
 *
 * An emptied optional field becomes an explicit `null`, which is the API's way of
 * saying "clear it" — distinct from leaving the field out. `name` is never sent as
 * null, because every member has one; an empty name is a validation error instead.
 */
export function changedFields(form: ProfileForm, member: MemberDetail): MemberUpdate {
  const changes: MemberUpdate = {};

  const name = form.name.trim();
  if (name && name !== member.name) changes.name = name;

  for (const [formField, apiField] of TEXT_FIELDS) {
    const next = form[formField].trim() || null;
    if (next !== (member[apiField] ?? null)) {
      changes[apiField] = next;
    }
  }

  if (form.joiningDate !== member.joining_date) {
    changes.joining_date = form.joiningDate;
  }

  if (form.sponsorId !== (member.sponsor?.id ?? null)) {
    changes.sponsor_id = form.sponsorId;
  }

  return changes;
}

/** Whether leaving now would lose something the user typed. */
export function hasUnsavedChanges(form: ProfileForm, member: MemberDetail): boolean {
  return Object.keys(changedFields(form, member)).length > 0;
}
