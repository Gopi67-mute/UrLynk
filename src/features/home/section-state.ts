/**
 * Which of its four faces a dashboard section is showing.
 *
 * Every data-backed section on Home has the same four, and the order they are decided in
 * is the point: a failure is reported even when the cache happens to hold an empty list,
 * so "no members added yet" is never shown for a request that did not come back. An
 * empty answer only means empty once a request has actually succeeded.
 */

import type { ScreenState } from "@/lib/screen-state";

export type SectionState =
  /** The first request is still in flight: a skeleton, never a spinner over nothing. */
  | "loading"
  /** The request failed. The section says why, and offers a retry if one can help. */
  | "error"
  /** No connection, and nothing saved on this device to show in the meantime. */
  | "offline"
  /** The request succeeded and there is genuinely nothing to show. */
  | "empty"
  /** There is real data to render. */
  | "ready";

export function sectionState({
  isPending,
  isError,
  count,
}: {
  isPending: boolean;
  isError: boolean;
  /** How many items came back, or null when nothing has come back yet. */
  count: number | null;
}): SectionState {
  if (isError) return "error";
  if (isPending || count === null) return "loading";
  return count === 0 ? "empty" : "ready";
}

/**
 * The same four faces, plus one, decided from the section's screen state.
 *
 * The addition is "offline", and it exists because the alternatives are both lies: a
 * leader with no connection and nothing saved is not looking at a team with no members
 * ("empty"), and they are not looking at something that went wrong ("error"). Everything
 * else is unchanged, including the rule that matters most — a list that was previously
 * synchronized is shown, whatever the connection is doing now.
 */
export function sectionStateFor(state: ScreenState, count: number | null): SectionState {
  switch (state) {
    case "first-load":
      return "loading";
    case "offline-empty":
      return "offline";
    case "failed":
    case "signed-out":
      return "error";
    default:
      if (count === null) return "loading";
      return count === 0 ? "empty" : "ready";
  }
}
