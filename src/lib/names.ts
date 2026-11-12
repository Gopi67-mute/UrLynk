/** Up to two initials for an avatar, from a person's display name. */
export function initialsFor(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The first word of a display name — the part a team is named after.
 *
 * Splitting on whitespace only: a hyphenated or dotted first name is one word, so
 * "Anna-Maria Rossi" gives "Anna-Maria" rather than "Anna". Returns "" for a name that
 * is empty or nothing but whitespace, which callers treat as "no name yet".
 */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * A team's label, built from its leader's preferred name: "Gopinath J" → "Gopinath's Team".
 *
 * Only the first word is used, because the label is a short possessive and a full name
 * reads badly in one. The leader's full preferred name is shown in the greeting instead.
 *
 * Returns null when there is no usable name, so a caller shows its own fallback rather
 * than a malformed "'s Team". Nothing here is stored: the label is derived on every
 * read, so editing the preferred name renames the team label with it and the saved
 * name is never rewritten just to produce one.
 */
export function teamLabelFor(name: string | null | undefined): string | null {
  const first = firstNameOf(name ?? "");
  return first ? `${first}'s Team` : null;
}

/** An ISO date (YYYY-MM-DD) shown the way the device formats dates. */
export function formatIsoDate(isoDate: string): string {
  // Parsed as local noon so a timezone offset cannot shift it to the previous day.
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The calendar day of an instant, as the device would name it.
 *
 * For timestamps such as `created_at`, which are a moment in time rather than a
 * calendar day. Taking the first ten characters of the ISO string instead would give
 * the UTC day, which is the previous or next day for a device whose offset crosses
 * midnight. Unparseable input is returned untouched rather than shown as a bad date.
 */
export function formatTimestampDate(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** The YYYY-MM-DD form of a date, in the device's own timezone. */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
