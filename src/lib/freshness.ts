/**
 * How long ago the screen in front of you was last confirmed with the server.
 *
 * The rule this exists to serve: never present stale information as current. When a
 * screen is showing cached data it has to say when that data came from, and it has to
 * say it in words a leader can judge — "4 minutes ago" is reassuring, "on 6 November"
 * is a warning, and both are more use than a timestamp.
 *
 * Free of React and of the locale machinery the rest of the app uses for dates, so the
 * wording can be tested exactly. `now` is passed in rather than read, for the same
 * reason.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "Updated 4 minutes ago", and the rest of the ladder.
 *
 * Deliberately coarse. A count of seconds invites a leader to watch it, and the
 * difference between 40 and 50 seconds is not a difference anyone acts on; what matters
 * is whether this is from a moment ago, from earlier today, or from another day.
 *
 * `null` when there is no recorded time — a screen with nothing to date says nothing
 * rather than guessing, and a time in the future (a device clock that moved) is read as
 * "just now" rather than as a negative age.
 */
export function lastSyncedText(updatedAt: number | null | undefined, now: number): string | null {
  if (!updatedAt) return null;

  const age = now - updatedAt;
  if (age < MINUTE_MS) return "Updated just now";

  if (age < HOUR_MS) {
    const minutes = Math.floor(age / MINUTE_MS);
    return `Updated ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }

  if (age < DAY_MS) {
    const hours = Math.floor(age / HOUR_MS);
    return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(age / DAY_MS);
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}
