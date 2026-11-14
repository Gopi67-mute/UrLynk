import type { ScreenState } from "./screen-state";

export type SlotState = "loading" | "unavailable" | "filled" | "open";

/**
 * What a LEFT or RIGHT position can honestly be said to be right now.
 *
 * "unavailable" is the one that matters: when the request for a parent's two members
 * fails, the position is not *known* to be open. Drawing it as open would invite a
 * placement into a slot that may already be taken, and the backend would then reject
 * it. The screens show "Not available" and offer a refresh instead.
 *
 * Checked in this order on purpose: a failed request is reported even while a second,
 * dependent request is still disabled and therefore reads as pending.
 */
export function slotState(
  pending: boolean,
  error: unknown,
  member: unknown | null,
): SlotState {
  if (error) return "unavailable";
  if (pending) return "loading";
  return member ? "filled" : "open";
}

/**
 * The same judgement, made from a screen's state rather than from two raw flags.
 *
 * What changes with a cache is which of those flags can be trusted. A screen showing
 * previously synchronized positions is *not* loading and *not* unavailable, even with no
 * connection and even with a failed refresh behind it: the positions on it were real
 * when they were saved, and the notice above them says when that was. Only a screen with
 * nothing to show falls back to "unavailable" — and it still refuses to draw an unknown
 * position as open, for the original reason: inviting a placement into a slot that may
 * already be taken produces a registration the backend then refuses.
 */
export function slotStateFor(state: ScreenState, member: unknown | null): SlotState {
  switch (state) {
    case "first-load":
      return "loading";
    case "failed":
    case "offline-empty":
    case "signed-out":
      return "unavailable";
    default:
      return member ? "filled" : "open";
  }
}
