/**
 * What a screen backed by cached data is actually doing, in one word.
 *
 * Before this, a screen had two facts to work with — "pending" and "error" — and had to
 * spell everything else out of them. That is how a dashboard full of perfectly good
 * cached numbers ends up replaced by an error card because a background refresh failed,
 * and how "you are offline" ends up being reported as "we couldn't load your team".
 *
 * Seven states, because there are seven genuinely different things to say. The order
 * they are decided in carries the judgements:
 *
 * 1. **An ended session outranks everything.** Cached data must not be presented as a
 *    signed-in leader's live team once the session behind it is gone.
 * 2. **Having data outranks not having it.** Anything on screen is better than a
 *    spinner over nothing, provided the screen says what it is.
 * 3. **Being offline outranks the error it caused.** "No connection" is the reason; the
 *    failed request is only the symptom, and reporting the symptom is what made the app
 *    blame itself for the Underground.
 *
 * Free of React, so the rules are tested directly rather than inferred from a rendered
 * tree — the same approach as `section-state.ts` and `search-query.ts`.
 */

import type { FailureKind } from "./failure";

export type ScreenState =
  /** Nothing cached, and a first request is on its way. Show a skeleton. */
  | "first-load"
  /** Nothing cached and no connection. Say so; do not show an empty team. */
  | "offline-empty"
  /** Nothing cached and the request failed. Show what happened, and a retry. */
  | "failed"
  /** Cached data on screen, with a background refresh in flight. Show the data. */
  | "refreshing"
  /** Cached data on screen, and no connection to refresh it with. */
  | "offline-stale"
  /** Cached data on screen, and the last refresh failed. Keep the data, say so quietly. */
  | "refresh-failed"
  /** The session has ended. Nothing cached may be shown as current. */
  | "signed-out"
  /** Current data, nothing in flight. */
  | "ready";

export type ScreenStateInput = {
  /** Whether there is anything at all to render — cached or fresh. */
  hasData: boolean;
  /** A request is in flight right now. */
  isFetching: boolean;
  /** The last attempt failed. */
  isError: boolean;
  /** How that failure should be read, from `describeFailure`. Null when none. */
  failure: FailureKind | null;
  isOnline: boolean;
};

export function screenState(input: ScreenStateInput): ScreenState {
  if (input.failure === "session") return "signed-out";

  if (!input.hasData) {
    if (!input.isOnline) return "offline-empty";
    if (input.isError) return "failed";
    return "first-load";
  }

  if (!input.isOnline) return "offline-stale";
  if (input.isError) return "refresh-failed";
  if (input.isFetching) return "refreshing";
  return "ready";
}

/**
 * How bad each state is, when a screen is built from more than one request.
 *
 * Home's branch cards need the team overview (for the root and the counts) *and* the
 * root's two members. The honest state for the pair is the worse of the two: a screen is
 * only "ready" when everything on it is, and one request that never arrived is enough to
 * make the whole of it something other than current.
 */
const SEVERITY: Record<ScreenState, number> = {
  ready: 0,
  refreshing: 1,
  "refresh-failed": 2,
  "offline-stale": 3,
  "first-load": 4,
  failed: 5,
  "offline-empty": 6,
  "signed-out": 7,
};

/** The state a screen made of two requests is really in. */
export function worseOf(first: ScreenState, second: ScreenState): ScreenState {
  return SEVERITY[first] >= SEVERITY[second] ? first : second;
}

/** Whether this state means there is data on screen to read. */
export function hasVisibleData(state: ScreenState): boolean {
  return (
    state === "ready"
    || state === "refreshing"
    || state === "offline-stale"
    || state === "refresh-failed"
  );
}

/**
 * Whether what is on screen might be out of date.
 *
 * The one thing the app must never do is present stale information as current, so this
 * is what drives the notice above the content. A background refresh in flight does not
 * count: the data is current as far as anyone knows, and something is already being
 * done about it.
 */
export function needsFreshnessNotice(state: ScreenState): boolean {
  return state === "offline-stale" || state === "refresh-failed";
}

/**
 * Whether a write may be attempted.
 *
 * V1 has no offline writes and does not queue them (AGENTS.md §5.2), so a form must
 * refuse rather than accept something it cannot send. Refusing up front is also the only
 * honest option with queries paused: a mutation sent while offline would sit pending
 * with nothing to show for it.
 */
export function canWrite(isOnline: boolean): boolean {
  return isOnline;
}
