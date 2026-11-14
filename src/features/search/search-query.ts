/**
 * What the Search screen is doing, decided once and tested on its own.
 *
 * Free of React and of every import the screen needs, so the rules below can be run
 * directly under Node rather than inferred from a rendered tree. The screen renders
 * whichever of the five faces this returns; it does not decide between them itself.
 */

/**
 * How long the field stays quiet before a search is sent.
 *
 * Long enough that typing a ten-digit Mi Lifestyle ID is one request rather than ten,
 * short enough that a leader who stops typing does not notice waiting. The app has no
 * other debounced input, so this is the convention rather than a copy of one.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/** Nothing is searched for until there is something to search for. */
export const MIN_QUERY_LENGTH = 1;

export type SearchState =
  /** Nothing has been typed: the screen explains what can be searched for. */
  | "idle"
  /** A request is in flight, or one is about to be. */
  | "searching"
  /** The request failed. The screen says why, and offers a retry if one can help. */
  | "error"
  /** No connection, so this question cannot be asked at all. */
  | "offline"
  /** The search succeeded and matched nobody. */
  | "no-results"
  /** There are matches to show. */
  | "results";

/**
 * The query as it is sent: surrounding whitespace is not part of what anyone searched
 * for, and a field holding only spaces is an empty field.
 */
export function normalizeQuery(raw: string): string {
  return raw.trim();
}

/** Whether this query is worth a request at all. */
export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

/**
 * Which face the screen is showing.
 *
 * `typed` is what is in the field right now; `submitted` is the query the results in
 * hand belong to. They differ while the field is settling, and that gap is the point:
 * results for "aja" are never presented as the answer to "ajay". Checking it before the
 * error and empty cases is deliberate — a failed older search must not sit on the screen
 * as the verdict on something the user has since changed.
 *
 * An empty field always wins: clearing the box restores the opening state immediately,
 * rather than leaving the last results behind under an empty query.
 *
 * `resultCount` is null until a request has actually come back. A failure outranks an
 * empty list for the same reason it does elsewhere in the app: "no members found" must
 * never stand in for a request that never arrived.
 *
 * `isOnline` is checked only once there is nothing to show. Search is the one screen in
 * the app that genuinely cannot work offline — the matching happens in PostgreSQL over
 * the whole team, and the alternative would be downloading the directory to the phone to
 * filter it, which is exactly what this feature was built not to do. So with no
 * connection and no answer in hand it says so plainly, rather than reporting that
 * nobody matched. Results already fetched in this session stay readable: they were a
 * real answer when they arrived, and the query they belong to is part of their key.
 */
export function searchState({
  typed,
  submitted,
  isPending,
  isError,
  resultCount,
  isOnline = true,
}: {
  typed: string;
  submitted: string;
  isPending: boolean;
  isError: boolean;
  resultCount: number | null;
  isOnline?: boolean;
}): SearchState {
  if (!isSearchable(typed)) return "idle";
  if (normalizeQuery(typed) !== submitted) return "searching";
  if (isError) return "error";
  if (resultCount !== null) return resultCount === 0 ? "no-results" : "results";
  if (!isOnline) return "offline";
  return "searching";
}

/** "3 members found", in words rather than a bare number. */
export function resultCountText(count: number, hasMore: boolean): string {
  if (count === 0) return "No members found";
  const members = count === 1 ? "member" : "members";
  return hasMore ? `First ${count} ${members}` : `${count} ${members} found`;
}

/**
 * How a result's position reads on its row: "LEFT under Ajay".
 *
 * Null for the leader's own record, which has no placement, so the row can say what it
 * is instead of leaving a gap where a position would go.
 */
export function placementText(
  position: "LEFT" | "RIGHT" | null,
  parentName: string | null,
): string | null {
  if (position === null) return null;
  return parentName ? `${position} under ${parentName}` : position;
}
