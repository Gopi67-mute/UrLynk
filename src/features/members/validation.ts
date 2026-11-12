/**
 * The same rules the backend enforces, checked here so the user sees a problem before
 * a round trip. These are a convenience, never the guarantee: every rule is enforced
 * again in PostgreSQL and in the API, which is what actually decides.
 */

export const MEMBER_LIMITS = {
  name: 120,
  /** Exactly this many digits, not a maximum: see `validateMiLifestyleId`. */
  miLifestyleId: 10,
  phoneNumber: 32,
  notes: 500,
} as const;

export const EARLIEST_JOINING_DATE = new Date(2000, 0, 1);

const PHONE_ALLOWED = /^[0-9 +\-().]+$/;
const MINIMUM_PHONE_DIGITS = 6;

export function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter the member's name.";
  if (name.length > MEMBER_LIMITS.name) {
    return `Keep the name under ${MEMBER_LIMITS.name} characters.`;
  }
  return null;
}

/**
 * Required, and exactly ten digits.
 *
 * Kept as typed rather than parsed as a number, so a leading zero is part of the ID and
 * "0012345678" stays ten characters long.
 *
 * The length is exact, not a maximum, so too short and too long are both wrong and are
 * told apart: "enter all 10 digits" is a different mistake from "that's too many".
 */
export function validateMiLifestyleId(value: string): string | null {
  const id = value.trim();
  if (!id) return "Enter the member's 10-digit Mi Lifestyle ID.";
  if (!/^[0-9]+$/.test(id)) return "The Mi Lifestyle ID can only contain digits.";
  if (id.length < MEMBER_LIMITS.miLifestyleId) {
    return `That's only ${id.length} ${id.length === 1 ? "digit" : "digits"}. Enter all ${MEMBER_LIMITS.miLifestyleId}.`;
  }
  if (id.length > MEMBER_LIMITS.miLifestyleId) {
    return `A Mi Lifestyle ID is exactly ${MEMBER_LIMITS.miLifestyleId} digits.`;
  }
  return null;
}

export function validatePhoneNumber(value: string): string | null {
  const phone = value.trim();
  if (!phone) return null;
  if (!PHONE_ALLOWED.test(phone)) return "Use only digits, spaces and + - ( ) .";
  const digits = phone.replace(/\D/g, "").length;
  if (digits < MINIMUM_PHONE_DIGITS) return "Enter at least 6 digits.";
  if (phone.length > MEMBER_LIMITS.phoneNumber) return "That phone number is too long.";
  return null;
}

export function validateNotes(value: string): string | null {
  if (value.trim().length > MEMBER_LIMITS.notes) {
    return `Keep notes under ${MEMBER_LIMITS.notes} characters.`;
  }
  return null;
}

export function validateJoiningDate(date: Date | null): string | null {
  if (!date) return null;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date.getTime() > endOfToday.getTime()) return "The joining date cannot be in the future.";
  if (date.getTime() < EARLIEST_JOINING_DATE.getTime()) return "That date is too far in the past.";
  return null;
}
